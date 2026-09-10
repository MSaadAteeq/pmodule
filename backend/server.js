/**
 * Parakeet Cloud API — same auth/usage/coupons as local SQLite, so the app can sync across devices.
 * Deploy this (e.g. Railway, Render, or a VPS) and set the base URL in the desktop app.
 */

import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || "./parakeet_cloud.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const CHAOS_ENABLED = process.env.PARAKEET_CHAOS === "1";
const CHAOS_ERROR_RATE = Math.min(1, Math.max(0, Number(process.env.PARAKEET_CHAOS_ERROR_RATE || 0)));
const CHAOS_DELAY_MS = Math.max(0, Number(process.env.PARAKEET_CHAOS_DELAY_MS || 0));
const CHAOS_JITTER_MS = Math.max(0, Number(process.env.PARAKEET_CHAOS_JITTER_MS || 0));
const CHAOS_PATH_PREFIXES = (process.env.PARAKEET_CHAOS_PATH_PREFIXES || "/auth,/usage,/coupon")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldInjectChaos(pathname) {
  if (pathname === "/health") return false;
  if (CHAOS_PATH_PREFIXES.length === 0) return true;
  return CHAOS_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(async (req, res, next) => {
  if (!CHAOS_ENABLED || !shouldInjectChaos(req.path)) {
    next();
    return;
  }

  const jitter = CHAOS_JITTER_MS > 0 ? Math.floor(Math.random() * (CHAOS_JITTER_MS + 1)) : 0;
  const delayMs = CHAOS_DELAY_MS + jitter;
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  if (CHAOS_ERROR_RATE > 0 && Math.random() < CHAOS_ERROR_RATE) {
    res.status(503).json({ error: "Injected chaos failure (test mode)" });
    return;
  }

  next();
});

const SUPERADMIN_EMAIL = "superadmin@parakeet.local";
const SUPERADMIN_DEFAULT_PASSWORD = "SuperAdmin123!";

// Schema (mirror src-tauri db.rs)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    minutes_used REAL NOT NULL DEFAULT 0,
    sessions_used INTEGER NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT 'free',
    sessions_remaining INTEGER NOT NULL DEFAULT 0,
    plan_expires_at TEXT,
    last_coupon_code TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    sessions_granted INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

try {
  db.prepare("ALTER TABLE user_usage ADD COLUMN last_coupon_code TEXT").run();
} catch (_) {}
try {
  db.prepare("ALTER TABLE user_usage ADD COLUMN account_paused INTEGER NOT NULL DEFAULT 0").run();
} catch (_) {}

const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
if (countUsers.get().n === 0) {
  const id = uuidv4();
  const hash = bcrypt.hashSync(SUPERADMIN_DEFAULT_PASSWORD, 10);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'superadmin', ?)"
  ).run(id, SUPERADMIN_EMAIL, hash, now);
  db.prepare(
    "INSERT INTO user_usage (id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at) VALUES (?, ?, 0, 0, 'unlimited', 0, NULL, ?)"
  ).run(uuidv4(), id, now);
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  const row = db.prepare(
    "SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
  ).get(token);
  if (!row) {
    return res.status(401).json({ error: "Session expired or invalid" });
  }
  req.user = { id: row.id, email: row.email, role: row.role };
  req.token = token;
  next();
}

function requireSuperadmin(req, res, next) {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function requireNotPausedUser(req, res, next) {
  if (req.user.role === "superadmin") return next();
  const row = db.prepare("SELECT COALESCE(account_paused, 0) AS p FROM user_usage WHERE user_id = ?").get(req.user.id);
  if (row && row.p) {
    return res.status(403).json({ error: "Account paused. Contact support." });
  }
  next();
}

// ---- Auth ----
app.post("/auth/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  const user = db.prepare("SELECT id, email, password_hash, role FROM users WHERE LOWER(email) = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.role !== "superadmin") {
    const st = db.prepare("SELECT COALESCE(account_paused, 0) AS p FROM user_usage WHERE user_id = ?").get(user.id);
    if (st && st.p) {
      return res.status(403).json({ error: "Account paused. Contact support." });
    }
  }
  const token = uuidv4();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)").run(
    uuidv4(),
    user.id,
    token,
    expires
  );
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

app.post("/auth/signup", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  try {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)"
    ).run(id, email, hash, now);
  } catch (e) {
    if (e.message && e.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Email already registered" });
    }
    throw e;
  }
  db.prepare(
    "INSERT INTO user_usage (id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at) VALUES (?, ?, 0, 0, 'free', 0, NULL, ?)"
  ).run(uuidv4(), id, now);
  const token = uuidv4();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)").run(
    uuidv4(),
    id,
    token,
    expires
  );
  res.json({
    token,
    user: { id, email, role: "user" },
  });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(req.token);
  res.json({ ok: true });
});

app.get("/auth/session", requireAuth, (req, res) => {
  const openaiApiKey = req.user.role === "superadmin"
    ? (db.prepare("SELECT value FROM config WHERE key = 'openai_api_key'").get()?.value ?? null)
    : null;
  res.json({
    user: { id: req.user.id, email: req.user.email, role: req.user.role },
    openaiApiKey: openaiApiKey || undefined,
  });
});

// ---- Usage ----
app.get("/usage", requireAuth, (req, res) => {
  const row = db
    .prepare(
      "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at, COALESCE(account_paused, 0) AS account_paused FROM user_usage WHERE user_id = ?"
    )
    .get(req.user.id);
  if (!row) {
    return res.status(404).json({ error: "Usage not found" });
  }
  res.json({ ...row, account_paused: !!row.account_paused });
});

app.post("/usage/record", requireAuth, requireNotPausedUser, (req, res) => {
  const minutes = Number(req.body.minutes) || 0;
  const row = db
    .prepare(
      "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at FROM user_usage WHERE user_id = ?"
    )
    .get(req.user.id);
  if (!row) {
    return res.status(404).json({ error: "Usage not found" });
  }
  const newMinutes = row.minutes_used + minutes;
  const newSessionsUsed = row.sessions_used + 1;
  const newSessionsRemaining =
    row.plan === "pack_3" || row.plan === "pack_10"
      ? Math.max(0, row.sessions_remaining - 1)
      : row.sessions_remaining;
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE user_usage SET minutes_used = ?, sessions_used = ?, sessions_remaining = ?, updated_at = ? WHERE user_id = ?"
  ).run(newMinutes, newSessionsUsed, newSessionsRemaining, now, req.user.id);
  const updated = db
    .prepare(
      "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at, COALESCE(account_paused, 0) AS account_paused FROM user_usage WHERE user_id = ?"
    )
    .get(req.user.id);
  res.json({ ...updated, account_paused: !!updated.account_paused });
});

app.post("/coupon/apply", requireAuth, requireNotPausedUser, (req, res) => {
  const code = (req.body.code || "").trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ error: "Coupon code required" });
  }
  const coupon = db
    .prepare(
      "SELECT code, plan, sessions_granted, expires_at, created_at FROM coupons WHERE UPPER(TRIM(code)) = ?"
    )
    .get(code);
  if (!coupon) {
    return res.status(400).json({ error: "Invalid or expired coupon" });
  }
  if (new Date(coupon.expires_at) < new Date()) {
    return res.status(400).json({ error: "Coupon has expired" });
  }
  const now = new Date();
  const nowStr = now.toISOString();
  let newPlan = "free";
  let newSessions = 0;
  let newExpires = null;
  if (coupon.plan === "unlimited") {
    newPlan = "unlimited";
    newExpires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  } else if (coupon.plan === "pack_3") {
    newPlan = "pack_3";
    newSessions = coupon.sessions_granted ?? 3;
  } else if (coupon.plan === "pack_10") {
    newPlan = "pack_10";
    newSessions = coupon.sessions_granted ?? 10;
  }
  db.prepare(
    "UPDATE user_usage SET plan = ?, sessions_remaining = ?, plan_expires_at = ?, last_coupon_code = ?, updated_at = ? WHERE user_id = ?"
  ).run(newPlan, newSessions, newExpires, coupon.code, nowStr, req.user.id);
  const updated = db
    .prepare(
      "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at, COALESCE(account_paused, 0) AS account_paused FROM user_usage WHERE user_id = ?"
    )
    .get(req.user.id);
  res.json({ ...updated, account_paused: !!updated.account_paused });
});

// ---- Admin ----
app.get("/admin/users", requireAuth, requireSuperadmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.role, COALESCE(uu.plan, 'free'), COALESCE(uu.sessions_remaining, 0),
              uu.plan_expires_at, uu.last_coupon_code, COALESCE(uu.account_paused, 0) AS account_paused
       FROM users u LEFT JOIN user_usage uu ON u.id = uu.user_id ORDER BY u.email`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      plan: r.plan,
      sessions_remaining: r.sessions_remaining,
      plan_expires_at: r.plan_expires_at,
      last_coupon_code: r.last_coupon_code,
      account_paused: !!r.account_paused,
    }))
  );
});

app.post("/admin/remove-subscription", requireAuth, requireSuperadmin, (req, res) => {
  const userId = req.body.userId || req.body.user_id;
  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE user_usage SET plan = 'free', sessions_remaining = 0, plan_expires_at = NULL, last_coupon_code = NULL, updated_at = ? WHERE user_id = ?"
  ).run(now, userId);
  res.json({ ok: true });
});

app.post("/admin/coupons", requireAuth, requireSuperadmin, (req, res) => {
  const code = (req.body.code || "").trim().toUpperCase();
  const plan = (req.body.plan || "").trim().toLowerCase();
  const expiresInDays = Math.max(1, parseInt(req.body.expiresInDays || req.body.expires_in_days, 10) || 30);
  if (!code) {
    return res.status(400).json({ error: "Coupon code required" });
  }
  if (!["pack_3", "pack_10", "unlimited"].includes(plan)) {
    return res.status(400).json({ error: "Plan must be pack_3, pack_10, or unlimited" });
  }
  const now = new Date();
  const expires = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const sessionsGranted = plan === "pack_3" ? 3 : plan === "pack_10" ? 10 : null;
  db.prepare(
    "INSERT INTO coupons (code, plan, sessions_granted, expires_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET plan = excluded.plan, sessions_granted = excluded.sessions_granted, expires_at = excluded.expires_at"
  ).run(code, plan, sessionsGranted, expires, now.toISOString());
  res.json({ ok: true });
});

app.delete("/admin/coupons/:code", requireAuth, requireSuperadmin, (req, res) => {
  const code = (req.params.code || "").trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ error: "Code required" });
  }
  db.prepare("DELETE FROM coupons WHERE UPPER(TRIM(code)) = ?").run(code);
  res.json({ ok: true });
});

app.get("/admin/coupons", requireAuth, requireSuperadmin, (req, res) => {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      "SELECT code, plan, sessions_granted, expires_at, created_at FROM coupons WHERE expires_at >= ? ORDER BY expires_at"
    )
    .all(now);
  res.json(rows);
});

app.post("/admin/openai-key", requireAuth, requireSuperadmin, (req, res) => {
  const apiKey = (req.body.apiKey || req.body.api_key || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "API key cannot be empty" });
  }
  db.prepare("INSERT INTO config (key, value) VALUES ('openai_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    apiKey
  );
  res.json({ ok: true });
});

app.post("/admin/user/account-paused", requireAuth, requireSuperadmin, (req, res) => {
  const userId = req.body.userId || req.body.user_id;
  const paused = !!req.body.paused;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "superadmin") return res.status(400).json({ error: "Cannot pause superadmin" });
  const now = new Date().toISOString();
  db.prepare("UPDATE user_usage SET account_paused = ?, updated_at = ? WHERE user_id = ?").run(paused ? 1 : 0, now, userId);
  if (paused) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  res.json({ ok: true });
});

app.delete("/admin/user/:userId", requireAuth, requireSuperadmin, (req, res) => {
  const userId = (req.params.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (userId === req.user.id) return res.status(400).json({ error: "Cannot delete yourself" });
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "superadmin") return res.status(400).json({ error: "Cannot delete superadmin" });
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM user_usage WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  res.json({ ok: true });
});

app.post("/admin/user/plan", requireAuth, requireSuperadmin, (req, res) => {
  const userId = req.body.userId || req.body.user_id;
  const plan = (req.body.plan || "").trim().toLowerCase();
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (!["free", "pack_3", "pack_10", "unlimited"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "superadmin") return res.status(400).json({ error: "Use coupons for users; superadmin stays unlimited" });
  let sessionsRemaining = Number(req.body.sessionsRemaining ?? req.body.sessions_remaining);
  if (Number.isNaN(sessionsRemaining)) {
    if (plan === "pack_3") sessionsRemaining = 3;
    else if (plan === "pack_10") sessionsRemaining = 10;
    else sessionsRemaining = 0;
  }
  let planExpiresAt = req.body.planExpiresAt ?? req.body.plan_expires_at ?? null;
  if (plan === "unlimited" && !planExpiresAt) {
    planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (plan === "free" || plan === "pack_3" || plan === "pack_10") {
    planExpiresAt = null;
  }
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE user_usage SET plan = ?, sessions_remaining = ?, plan_expires_at = ?, updated_at = ? WHERE user_id = ?"
  ).run(plan, sessionsRemaining, planExpiresAt, now, userId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3765;
app.listen(PORT, () => {
  console.log(`Parakeet Cloud API at http://localhost:${PORT}`);
});
