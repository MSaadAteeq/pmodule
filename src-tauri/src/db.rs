//! Local SQLite auth, usage, and coupons. No external services.

use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

const SUPERADMIN_EMAIL: &str = "superadmin@parakeet.local";
const SUPERADMIN_DEFAULT_PASSWORD: &str = "SuperAdmin123!";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub role: String, // "user" | "superadmin"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserUsageRow {
    pub id: String,
    pub user_id: String,
    pub minutes_used: f64,
    pub sessions_used: i64,
    pub plan: String,
    pub sessions_remaining: i64,
    pub plan_expires_at: Option<String>,
    #[serde(default)]
    pub last_coupon_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouponRow {
    pub code: String,
    pub plan: String,
    pub sessions_granted: Option<i64>,
    pub expires_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserWithUsage {
    pub id: String,
    pub email: String,
    pub plan: String,
    pub sessions_remaining: i64,
    pub plan_expires_at: Option<String>,
    pub last_coupon_code: Option<String>,
}

static DB: Mutex<Option<Connection>> = Mutex::new(None);

fn open_conn(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
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
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
        ",
    )
    .map_err(|e| e.to_string())?;

    // Add last_coupon_code to user_usage if missing (existing DBs)
    let _ = conn.execute("ALTER TABLE user_usage ADD COLUMN last_coupon_code TEXT", []);

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    // Seed superadmin if no users
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count == 0 {
        let id = uuid::Uuid::new_v4().to_string();
        let password_hash = hash(SUPERADMIN_DEFAULT_PASSWORD, DEFAULT_COST).map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?1, ?2, ?3, 'superadmin', ?4)",
            params![id, SUPERADMIN_EMAIL, password_hash, now],
        )
        .map_err(|e| e.to_string())?;

        let usage_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO user_usage (id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at) VALUES (?1, ?2, 0, 0, 'unlimited', 0, NULL, ?3)",
            params![usage_id, id, now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(conn)
}

pub fn init_db(path: &Path) -> Result<(), String> {
    let mut guard = DB.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(open_conn(path)?);
    }
    Ok(())
}

fn with_db<T, F: FnOnce(&Connection) -> Result<T, String>>(f: F) -> Result<T, String> {
    let guard = DB.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    f(conn)
}

pub fn auth_login(email: &str, password: &str) -> Result<(String, User), String> {
    with_db(|conn| {
        let email = email.trim().to_lowercase();
        if email.is_empty() || password.is_empty() {
            return Err("Email and password required".to_string());
        }
        let row = conn
            .query_row(
                "SELECT id, email, password_hash, role FROM users WHERE LOWER(email) = ?1",
                [&email],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .map_err(|_| "Invalid email or password".to_string())?;
        let (id, em, hash, role) = row;
        let valid = verify(password, &hash).map_err(|_| "Invalid email or password".to_string())?;
        if !valid {
            return Err("Invalid email or password".to_string());
        }
        let token = uuid::Uuid::new_v4().to_string();
        let expires = Utc::now() + chrono::Duration::days(30);
        let session_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, id, token, expires.to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok((
            token,
            User {
                id,
                email: em,
                role,
            },
        ))
    })
}

pub fn auth_signup(email: &str, password: &str) -> Result<(String, User), String> {
    with_db(|conn| {
        let email = email.trim().to_lowercase();
        if email.is_empty() || password.is_empty() {
            return Err("Email and password required".to_string());
        }
        if password.len() < 8 {
            return Err("Password must be at least 8 characters".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let password_hash = hash(password, DEFAULT_COST).map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?1, ?2, ?3, 'user', ?4)",
            params![id, email, password_hash, now],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "Email already registered".to_string()
            } else {
                e.to_string()
            }
        })?;
        let usage_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO user_usage (id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, updated_at) VALUES (?1, ?2, 0, 0, 'free', 0, NULL, ?3)",
            params![usage_id, id, now],
        )
        .map_err(|e| e.to_string())?;
        let token = uuid::Uuid::new_v4().to_string();
        let expires = Utc::now() + chrono::Duration::days(30);
        let session_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, id, token, expires.to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok((
            token,
            User {
                id,
                email,
                role: "user".to_string(),
            },
        ))
    })
}

pub fn auth_validate_token(token: &str) -> Result<User, String> {
    with_db(|conn| {
        let now = Utc::now().to_rfc3339();
        // Remove expired sessions
        let _ = conn.execute("DELETE FROM sessions WHERE expires_at < ?1", [&now]);
        let row = conn
            .query_row(
                "SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?1",
                [token],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            )
            .map_err(|_| "Session expired or invalid".to_string())?;
        Ok(User {
            id: row.0,
            email: row.1,
            role: row.2,
        })
    })
}

pub fn auth_logout(token: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM sessions WHERE token = ?1", [token])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn get_usage(token: &str) -> Result<UserUsageRow, String> {
    let user = auth_validate_token(token)?;
    with_db(|conn| {
            let row = conn
            .query_row(
                "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, last_coupon_code, updated_at FROM user_usage WHERE user_id = ?1",
                [&user.id],
                |r| {
                    Ok(UserUsageRow {
                        id: r.get(0)?,
                        user_id: r.get(1)?,
                        minutes_used: r.get(2)?,
                        sessions_used: r.get(3)?,
                        plan: r.get(4)?,
                        sessions_remaining: r.get(5)?,
                        plan_expires_at: r.get(6)?,
                        last_coupon_code: r.get(7)?,
                        updated_at: r.get(8)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        Ok(row)
    })
}

pub fn record_session(token: &str, minutes: f64) -> Result<UserUsageRow, String> {
    let user = auth_validate_token(token)?;
    with_db(|conn| {
        let row: UserUsageRow = conn
            .query_row(
                "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, last_coupon_code, updated_at FROM user_usage WHERE user_id = ?1",
                [&user.id],
                |r| {
                    Ok(UserUsageRow {
                        id: r.get(0)?,
                        user_id: r.get(1)?,
                        minutes_used: r.get(2)?,
                        sessions_used: r.get(3)?,
                        plan: r.get(4)?,
                        sessions_remaining: r.get(5)?,
                        plan_expires_at: r.get(6)?,
                        last_coupon_code: r.get(7)?,
                        updated_at: r.get(8)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        let new_minutes = row.minutes_used + minutes;
        let new_sessions_used = row.sessions_used + 1;
        let new_sessions_remaining = if row.plan == "pack_3" || row.plan == "pack_10" {
            (row.sessions_remaining - 1).max(0)
        } else {
            row.sessions_remaining
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE user_usage SET minutes_used = ?1, sessions_used = ?2, sessions_remaining = ?3, updated_at = ?4 WHERE user_id = ?5",
            params![new_minutes, new_sessions_used, new_sessions_remaining, now, user.id],
        )
        .map_err(|e| e.to_string())?;
        Ok(UserUsageRow {
            minutes_used: new_minutes,
            sessions_used: new_sessions_used,
            sessions_remaining: new_sessions_remaining,
            updated_at: now,
            ..row
        })
    })
}

pub fn apply_coupon(token: &str, code: &str) -> Result<UserUsageRow, String> {
    let user = auth_validate_token(token)?;
    let code = code.trim().to_uppercase();
    if code.is_empty() {
        return Err("Coupon code required".to_string());
    }
    with_db(|conn| {
        let now = Utc::now();
        let coupon: CouponRow = conn
            .query_row(
                "SELECT code, plan, sessions_granted, expires_at, created_at FROM coupons WHERE UPPER(TRIM(code)) = ?1",
                [&code],
                |r| {
                    Ok(CouponRow {
                        code: r.get(0)?,
                        plan: r.get(1)?,
                        sessions_granted: r.get::<_, Option<i64>>(2)?,
                        expires_at: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                },
            )
            .map_err(|_| "Invalid or expired coupon".to_string())?;

        let expires: DateTime<Utc> =
            DateTime::parse_from_rfc3339(&coupon.expires_at).map_err(|_| "Invalid coupon expiry".to_string())?.with_timezone(&Utc);
        if expires < now {
            return Err("Coupon has expired".to_string());
        }

        let _usage_id: String = conn
            .query_row("SELECT id FROM user_usage WHERE user_id = ?1", [&user.id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let now_str = now.to_rfc3339();

        let (new_plan, new_sessions, new_expires) = match coupon.plan.as_str() {
            "unlimited" => {
                let exp = now + chrono::Duration::days(30);
                ("unlimited".to_string(), 0i64, Some(exp.to_rfc3339()))
            }
            "pack_3" => ("pack_3".to_string(), coupon.sessions_granted.unwrap_or(3), None),
            "pack_10" => ("pack_10".to_string(), coupon.sessions_granted.unwrap_or(10), None),
            _ => ("free".to_string(), 0i64, None),
        };

        conn.execute(
            "UPDATE user_usage SET plan = ?1, sessions_remaining = ?2, plan_expires_at = ?3, last_coupon_code = ?4, updated_at = ?5 WHERE user_id = ?6",
            params![
                new_plan,
                new_sessions,
                new_expires,
                coupon.code,
                now_str,
                user.id
            ],
        )
        .map_err(|e| e.to_string())?;

        let row = conn
            .query_row(
                "SELECT id, user_id, minutes_used, sessions_used, plan, sessions_remaining, plan_expires_at, last_coupon_code, updated_at FROM user_usage WHERE user_id = ?1",
                [&user.id],
                |r| {
                    Ok(UserUsageRow {
                        id: r.get(0)?,
                        user_id: r.get(1)?,
                        minutes_used: r.get(2)?,
                        sessions_used: r.get(3)?,
                        plan: r.get(4)?,
                        sessions_remaining: r.get(5)?,
                        plan_expires_at: r.get(6)?,
                        last_coupon_code: r.get(7)?,
                        updated_at: r.get(8)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        Ok(row)
    })
}

// ---- Admin (superadmin only) ----

pub fn admin_require_superadmin(token: &str) -> Result<User, String> {
    let user = auth_validate_token(token)?;
    if user.role != "superadmin" {
        return Err("Forbidden".to_string());
    }
    Ok(user)
}

pub fn admin_list_users(token: &str) -> Result<Vec<UserWithUsage>, String> {
    admin_require_superadmin(token)?;
    with_db(|conn| {
        let rows = conn
            .prepare("SELECT u.id, u.email, COALESCE(uu.plan, 'free'), COALESCE(uu.sessions_remaining, 0), uu.plan_expires_at, uu.last_coupon_code FROM users u LEFT JOIN user_usage uu ON u.id = uu.user_id ORDER BY u.email")
            .map_err(|e| e.to_string())?
            .query_map([], |r| {
                Ok(UserWithUsage {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    plan: r.get(2)?,
                    sessions_remaining: r.get(3)?,
                    plan_expires_at: r.get(4)?,
                    last_coupon_code: r.get::<_, Option<String>>(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

pub fn admin_remove_subscription(token: &str, user_id: &str) -> Result<(), String> {
    admin_require_superadmin(token)?;
    with_db(|conn| {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE user_usage SET plan = 'free', sessions_remaining = 0, plan_expires_at = NULL, last_coupon_code = NULL, updated_at = ?1 WHERE user_id = ?2",
            params![now, user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn admin_add_coupon(token: &str, code: &str, plan: &str, expires_in_days: i64) -> Result<(), String> {
    admin_require_superadmin(token)?;
    let code = code.trim().to_uppercase();
    if code.is_empty() {
        return Err("Coupon code required".to_string());
    }
    let plan_lower = plan.trim().to_lowercase();
    let plan = match plan_lower.as_str() {
        "pack_3" | "pack_10" | "unlimited" => plan_lower,
        _ => return Err("Plan must be pack_3, pack_10, or unlimited".to_string()),
    };
    with_db(|conn| {
        let now = Utc::now();
        let expires = now + chrono::Duration::days(expires_in_days.max(1));
        let sessions = match plan.as_str() {
            "pack_3" => Some(3i64),
            "pack_10" => Some(10i64),
            _ => None,
        };
        conn.execute(
            "INSERT INTO coupons (code, plan, sessions_granted, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(code) DO UPDATE SET plan = excluded.plan, sessions_granted = excluded.sessions_granted, expires_at = excluded.expires_at",
            params![code, plan, sessions, expires.to_rfc3339(), now.to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn admin_remove_coupon(token: &str, code: &str) -> Result<(), String> {
    admin_require_superadmin(token)?;
    with_db(|conn| {
        conn.execute("DELETE FROM coupons WHERE UPPER(TRIM(code)) = ?1", [code.trim().to_uppercase()])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn get_config(key: &str) -> Option<String> {
    with_db(|conn| {
        Ok(conn
            .query_row("SELECT value FROM config WHERE key = ?1", [key], |r| r.get(0))
            .ok())
    })
    .ok()
    .flatten()
}

pub fn set_config(key: &str, value: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Returns OpenAI API key from config (set by superadmin) or from OPENAI_API_KEY env.
pub fn get_openai_api_key() -> Result<String, String> {
    get_config("openai_api_key")
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "OpenAI API key not set. Sign in as superadmin and set it in Admin.".to_string())
}

pub fn admin_set_openai_key(token: &str, api_key: &str) -> Result<(), String> {
    admin_require_superadmin(token)?;
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }
    set_config("openai_api_key", key)
}

pub fn admin_list_coupons(token: &str) -> Result<Vec<CouponRow>, String> {
    admin_require_superadmin(token)?;
    with_db(|conn| {
        let now = Utc::now().to_rfc3339();
        let rows = conn
            .prepare("SELECT code, plan, sessions_granted, expires_at, created_at FROM coupons WHERE expires_at >= ?1 ORDER BY expires_at")
            .map_err(|e| e.to_string())?
            .query_map([&now], |r| {
                Ok(CouponRow {
                    code: r.get(0)?,
                    plan: r.get(1)?,
                    sessions_granted: r.get::<_, Option<i64>>(2)?,
                    expires_at: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}
