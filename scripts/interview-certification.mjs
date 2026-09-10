#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const HARD_MODE_SCRIPT = path.join(ROOT_DIR, "scripts", "reliability-hard-mode.mjs");
const OUT_DIR = path.join(ROOT_DIR, "reports", "reliability");

const ENDURANCE_SOAK_MS = Number(process.env.PARAKEET_CERT_ENDURANCE_SOAK_MS || 90_000);

function phaseReportPath(name) {
  const ts = new Date().toISOString().replaceAll(":", "-");
  return path.join(OUT_DIR, `${ts}_${name}.json`);
}

function runPhase(name, envOverrides) {
  const reportPath = phaseReportPath(name);
  const env = {
    ...process.env,
    ...envOverrides,
    PARAKEET_REPORT_FILE: reportPath,
  };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HARD_MODE_SCRIPT], {
      cwd: ROOT_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      const t = String(d);
      out += t;
      process.stdout.write(t);
    });
    child.stderr.on("data", (d) => {
      const t = String(d);
      err += t;
      process.stderr.write(t);
    });
    child.on("close", (code) => {
      resolve({ name, code: code ?? 1, reportPath, out, err });
    });
  });
}

async function loadReport(reportPath) {
  const raw = await readFile(reportPath, "utf8");
  return JSON.parse(raw);
}

function summarizePhase(name, code, report) {
  const failedChecks = (report.checks || []).filter((c) => !c.pass);
  return {
    phase: name,
    exit_code: code,
    passed: code === 0 && failedChecks.length === 0,
    failed_checks: failedChecks.map((c) => `${c.name}: ${c.detail}`),
    total_requests: report.total_requests,
    total_errors: report.total_errors,
    total_runtime_ms: report.total_runtime_ms,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const phases = [
    {
      name: "baseline",
      env: {
        PARAKEET_LOAD_USERS: "30",
        PARAKEET_LOAD_RECORDS: "10",
        PARAKEET_SOAK_WORKERS: "8",
        PARAKEET_SOAK_MS: "20000",
      },
    },
    {
      name: "endurance",
      env: {
        PARAKEET_LOAD_USERS: "15",
        PARAKEET_LOAD_RECORDS: "8",
        PARAKEET_SOAK_WORKERS: "12",
        PARAKEET_SOAK_MS: String(ENDURANCE_SOAK_MS),
      },
    },
    {
      name: "chaos",
      env: {
        PARAKEET_LOAD_USERS: "20",
        PARAKEET_LOAD_RECORDS: "8",
        PARAKEET_SOAK_WORKERS: "8",
        PARAKEET_SOAK_MS: "30000",
        PARAKEET_CHAOS: "1",
        PARAKEET_CHAOS_ERROR_RATE: "0.02",
        PARAKEET_CHAOS_DELAY_MS: "140",
        PARAKEET_CHAOS_JITTER_MS: "180",
        PARAKEET_LIMIT_ERROR_RATE: "0.03",
        PARAKEET_LIMIT_USAGE_RECORD_P95: "900",
        PARAKEET_LIMIT_USAGE_RECORD_MAX: "1800",
        PARAKEET_LIMIT_USAGE_P95: "2500",
        PARAKEET_LIMIT_SIGNUP_P95: "9000",
        PARAKEET_LIMIT_SESSION_P95: "7000",
      },
    },
  ];

  const results = [];
  for (const phase of phases) {
    process.stdout.write(`\n=== Phase: ${phase.name} ===\n`);
    const run = await runPhase(phase.name, phase.env);
    let report = null;
    try {
      report = await loadReport(run.reportPath);
    } catch {
      report = {
        total_requests: 0,
        total_errors: 0,
        total_runtime_ms: 0,
        checks: [{ name: "report generation", pass: false, detail: "Missing report output file" }],
      };
    }
    results.push(summarizePhase(phase.name, run.code, report));
  }

  const failed = results.filter((r) => !r.passed);
  const verdict = failed.length === 0 ? "GO" : "NO_GO";

  const summary = {
    verdict,
    generated_at: new Date().toISOString(),
    phases: results,
    reports_dir: OUT_DIR,
  };

  process.stdout.write(`\n=== Interview Certification Verdict: ${verdict} ===\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (verdict !== "GO") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Certification run failed:", err);
  process.exit(1);
});
