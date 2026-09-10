#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { rm, writeFile } from "node:fs/promises";

const BASE_URL = process.env.PARAKEET_CLOUD_URL || "http://localhost:3765";
const BACKEND_DIR = fileURLToPath(new URL("../backend/", import.meta.url));
const STARTUP_TIMEOUT_MS = 20_000;
let spawnedDbPath = null;
const LOAD_USER_COUNT = Number(process.env.PARAKEET_LOAD_USERS || 40);
const LOAD_RECORDS_PER_USER = Number(process.env.PARAKEET_LOAD_RECORDS || 12);
const SOAK_WORKERS = Number(process.env.PARAKEET_SOAK_WORKERS || 8);
const SOAK_DURATION_MS = Number(process.env.PARAKEET_SOAK_MS || 20_000);
const REPORT_FILE = process.env.PARAKEET_REPORT_FILE || "";

function envNumber(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const LIMITS = {
  maxErrorRate: envNumber("PARAKEET_LIMIT_ERROR_RATE", 0),
  maxUsageRecordP95Ms: envNumber("PARAKEET_LIMIT_USAGE_RECORD_P95", 350),
  maxUsageRecordMaxMs: envNumber("PARAKEET_LIMIT_USAGE_RECORD_MAX", 700),
  maxUsageP95Ms: envNumber("PARAKEET_LIMIT_USAGE_P95", 1200),
  maxSignupP95Ms: envNumber("PARAKEET_LIMIT_SIGNUP_P95", 6_000),
  maxSessionP95Ms: envNumber("PARAKEET_LIMIT_SESSION_P95", 4_500),
};

/** @typedef {{path: string, ms: number, status: number}} ReqStat */
/** @type {ReqStat[]} */
const reqStats = [];
/** @type {string[]} */
const reqErrors = [];

function percentile(sortedNumbers, p) {
  if (sortedNumbers.length === 0) return 0;
  const idx = Math.min(sortedNumbers.length - 1, Math.floor((p / 100) * sortedNumbers.length));
  return sortedNumbers[idx];
}

function summarizeByPath(stats) {
  /** @type {Record<string, number[]>} */
  const grouped = {};
  for (const item of stats) {
    if (!grouped[item.path]) grouped[item.path] = [];
    grouped[item.path].push(item.ms);
  }
  /** @type {Record<string, {count:number, avg_ms:number, p95_ms:number, max_ms:number}>} */
  const summary = {};
  for (const [path, values] of Object.entries(grouped)) {
    const sorted = [...values].sort((a, b) => a - b);
    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    summary[path] = {
      count: values.length,
      avg_ms: avg,
      p95_ms: percentile(sorted, 95),
      max_ms: Math.max(...values),
    };
  }
  return summary;
}

async function request(path, { method = "GET", headers = {}, body } = {}) {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  reqStats.push({
    path,
    ms: Date.now() - started,
    status: response.status,
  });
  return { ok: response.ok, status: response.status, json, raw: text };
}

async function startBackend() {
  // If an instance is already running (common during local dev), reuse it.
  try {
    const probe = await fetch(`${BASE_URL}/usage`);
    if (probe.status === 401 || probe.status === 404 || probe.ok) {
      return null;
    }
  } catch {
    // no server reachable, start one below
  }

  const command = process.execPath;
  const args = ["server.js"];
  const tempDbPath = path.join(
    os.tmpdir(),
    `parakeet_hard_mode_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
  );
  spawnedDbPath = tempDbPath;
  const child = spawn(command, args, {
    cwd: BACKEND_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DB_PATH: tempDbPath,
    },
  });

  let ready = false;
  let output = "";
  const onData = (chunk) => {
    const text = String(chunk ?? "");
    output += text;
    if (text.includes("Parakeet Cloud API at")) {
      ready = true;
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const start = Date.now();
  while (!ready && Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}\n${output}`);
    }
    await delay(100);
  }
  if (!ready) {
    throw new Error(`Backend did not become ready within ${STARTUP_TIMEOUT_MS}ms\n${output}`);
  }
  return child;
}

function stopBackend(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

async function cleanupSpawnedDb() {
  if (!spawnedDbPath) return;
  try {
    await rm(spawnedDbPath, { force: true });
  } catch {
    // best effort cleanup
  } finally {
    spawnedDbPath = null;
  }
}

async function runNegativeTests() {
  const cases = [
    {
      name: "login missing fields",
      path: "/auth/login",
      method: "POST",
      body: {},
      expectStatus: 400,
    },
    {
      name: "signup weak password",
      path: "/auth/signup",
      method: "POST",
      body: { email: "weak@test.local", password: "123" },
      expectStatus: 400,
    },
    {
      name: "usage missing token",
      path: "/usage",
      method: "GET",
      expectStatus: 401,
    },
  ];

  for (const c of cases) {
    const r = await request(c.path, { method: c.method, body: c.body });
    if (r.status !== c.expectStatus) {
      reqErrors.push(
        `[negative] ${c.name} expected ${c.expectStatus} got ${r.status}: ${JSON.stringify(r.json)}`
      );
    }
  }
}

async function runConcurrentLoad() {
  const stamp = Date.now();
  const users = Array.from({ length: LOAD_USER_COUNT }, (_, i) => ({
    email: `hardmode_${stamp}_${i}@test.local`,
    password: "Password123!",
  }));

  await Promise.all(
    users.map(async (u) => {
      try {
        const signup = await request("/auth/signup", { method: "POST", body: u });
        if (!signup.ok || !signup.json?.token) {
          throw new Error(`signup failed ${signup.status} ${JSON.stringify(signup.json)}`);
        }
        const token = signup.json.token;
        const auth = { authorization: `Bearer ${token}` };

        const session = await request("/auth/session", { headers: auth });
        if (!session.ok) throw new Error(`session failed ${session.status}`);

        const usage = await request("/usage", { headers: auth });
        if (!usage.ok) throw new Error(`usage failed ${usage.status}`);

        for (let i = 0; i < LOAD_RECORDS_PER_USER; i += 1) {
          const record = await request("/usage/record", {
            method: "POST",
            headers: auth,
            body: { minutes: 0.3 },
          });
          if (!record.ok) throw new Error(`usage/record failed ${record.status}`);
        }
      } catch (err) {
        reqErrors.push(`[load] ${u.email}: ${String(err)}`);
      }
    })
  );
}

async function runSoakPhase() {
  const start = Date.now();
  const tokens = [];

  for (let i = 0; i < SOAK_WORKERS; i += 1) {
    const signup = await request("/auth/signup", {
      method: "POST",
      body: {
        email: `soak_${Date.now()}_${i}@test.local`,
        password: "Password123!",
      },
    });
    if (signup.ok && signup.json?.token) {
      tokens.push(signup.json.token);
    } else {
      reqErrors.push(`[soak] could not create worker user ${i}`);
    }
  }

  await Promise.all(
    tokens.map(async (token) => {
      const auth = { authorization: `Bearer ${token}` };
      while (Date.now() - start < SOAK_DURATION_MS) {
        const op = Math.random() < 0.75 ? "/usage/record" : "/usage";
        const method = op === "/usage/record" ? "POST" : "GET";
        const body = op === "/usage/record" ? { minutes: 0.1 } : undefined;
        try {
          const r = await request(op, { method, headers: auth, body });
          if (!r.ok) reqErrors.push(`[soak] ${op} status ${r.status}`);
        } catch (err) {
          reqErrors.push(`[soak] ${String(err)}`);
        }
        await delay(120);
      }
    })
  );
}

function evaluate(summary) {
  const checks = [];
  const addCheck = (name, pass, detail) => checks.push({ name, pass, detail });

  const totalReq = reqStats.length;
  const errorRate = totalReq === 0 ? 1 : reqErrors.length / totalReq;
  addCheck(
    "request error rate",
    errorRate <= LIMITS.maxErrorRate,
    `${(errorRate * 100).toFixed(2)}% (limit ${(LIMITS.maxErrorRate * 100).toFixed(2)}%)`
  );

  const rec = summary["/usage/record"];
  if (rec) {
    addCheck(
      "usage/record p95 latency",
      rec.p95_ms <= LIMITS.maxUsageRecordP95Ms,
      `${rec.p95_ms}ms (limit ${LIMITS.maxUsageRecordP95Ms}ms)`
    );
    addCheck(
      "usage/record max latency",
      rec.max_ms <= LIMITS.maxUsageRecordMaxMs,
      `${rec.max_ms}ms (limit ${LIMITS.maxUsageRecordMaxMs}ms)`
    );
  }

  const usage = summary["/usage"];
  if (usage) {
    addCheck(
      "usage p95 latency",
      usage.p95_ms <= LIMITS.maxUsageP95Ms,
      `${usage.p95_ms}ms (limit ${LIMITS.maxUsageP95Ms}ms)`
    );
  }

  const signup = summary["/auth/signup"];
  if (signup) {
    addCheck(
      "signup p95 latency",
      signup.p95_ms <= LIMITS.maxSignupP95Ms,
      `${signup.p95_ms}ms (limit ${LIMITS.maxSignupP95Ms}ms)`
    );
  }

  const session = summary["/auth/session"];
  if (session) {
    addCheck(
      "session p95 latency",
      session.p95_ms <= LIMITS.maxSessionP95Ms,
      `${session.p95_ms}ms (limit ${LIMITS.maxSessionP95Ms}ms)`
    );
  }

  return checks;
}

async function main() {
  const backend = await startBackend();
  const started = Date.now();
  try {
    await runNegativeTests();
    await runConcurrentLoad();
    await runSoakPhase();

    const summary = summarizeByPath(reqStats);
    const checks = evaluate(summary);
    const failed = checks.filter((c) => !c.pass);

    const report = {
      total_runtime_ms: Date.now() - started,
      total_requests: reqStats.length,
      total_errors: reqErrors.length,
      summary,
      limits: LIMITS,
      checks,
      error_samples: reqErrors.slice(0, 10),
    };

    console.log("=== Hard Mode Reliability Report ===");
    console.log(JSON.stringify(report, null, 2));
    if (REPORT_FILE) {
      await writeFile(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");
    }

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    stopBackend(backend);
    await cleanupSpawnedDb();
  }
}

main().catch((err) => {
  console.error("Hard mode run failed:", err);
  process.exit(1);
});
