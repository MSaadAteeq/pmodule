//! HTTP client for Parakeet Cloud API. When cloud_base_url is set, auth/usage/admin go here.

use serde::Deserialize;
use std::time::Duration;

use crate::db::{CouponRow, User, UserUsageRow, UserWithUsage};

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn base(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    format!("{}{}", base, path)
}

fn bearer(token: &str) -> String {
    format!("Bearer {}", token)
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    token: String,
    user: User,
}

#[derive(Debug, Deserialize)]
struct SessionResponse {
    user: User,
    #[serde(rename = "openaiApiKey")]
    openai_api_key: Option<String>,
}

pub fn auth_login(base_url: &str, email: &str, password: &str) -> Result<(String, User), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/auth/login"))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Login failed").to_string());
    }
    let data: LoginResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok((data.token, data.user))
}

pub fn auth_signup(base_url: &str, email: &str, password: &str) -> Result<(String, User), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/auth/signup"))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Signup failed").to_string());
    }
    let data: LoginResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok((data.token, data.user))
}

pub fn auth_logout(base_url: &str, token: &str) -> Result<(), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/auth/logout"))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err("Logout failed".to_string());
    }
    Ok(())
}

pub fn auth_session(base_url: &str, token: &str) -> Result<User, String> {
    let c = client()?;
    let res = c
        .get(base(base_url, "/auth/session"))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Session invalid").to_string());
    }
    let data: SessionResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if let Some(key) = data.openai_api_key {
        if !key.trim().is_empty() {
            let _ = crate::db::set_config("openai_api_key", &key);
        }
    }
    Ok(data.user)
}

pub fn get_usage(base_url: &str, token: &str) -> Result<UserUsageRow, String> {
    let c = client()?;
    let res = c
        .get(base(base_url, "/usage"))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed to get usage").to_string());
    }
    let row: UserUsageRow = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn record_session(base_url: &str, token: &str, minutes: f64) -> Result<UserUsageRow, String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/usage/record"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({ "minutes": minutes }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed to record session").to_string());
    }
    let row: UserUsageRow = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn apply_coupon(base_url: &str, token: &str, code: &str) -> Result<UserUsageRow, String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/coupon/apply"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({ "code": code }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Coupon failed").to_string());
    }
    let row: UserUsageRow = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn admin_list_users(base_url: &str, token: &str) -> Result<Vec<UserWithUsage>, String> {
    let c = client()?;
    let res = c
        .get(base(base_url, "/admin/users"))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Forbidden").to_string());
    }
    let rows: Vec<UserWithUsage> = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn admin_remove_subscription(base_url: &str, token: &str, user_id: &str) -> Result<(), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/admin/remove-subscription"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({ "userId": user_id }))
        .send()
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().unwrap_or_default();
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_add_coupon(
    base_url: &str,
    token: &str,
    code: &str,
    plan: &str,
    expires_in_days: i64,
) -> Result<(), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/admin/coupons"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({
            "code": code,
            "plan": plan,
            "expiresInDays": expires_in_days
        }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_remove_coupon(base_url: &str, token: &str, code: &str) -> Result<(), String> {
    let c = client()?;
    let res = c
        .delete(base(base_url, &format!("/admin/coupons/{}", urlencoding::encode(code))))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().unwrap_or_default();
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_list_coupons(base_url: &str, token: &str) -> Result<Vec<CouponRow>, String> {
    let c = client()?;
    let res = c
        .get(base(base_url, "/admin/coupons"))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Forbidden").to_string());
    }
    let rows: Vec<CouponRow> = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn admin_set_openai_key(base_url: &str, token: &str, api_key: &str) -> Result<(), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/admin/openai-key"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({ "apiKey": api_key }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_set_account_paused(
    base_url: &str,
    token: &str,
    user_id: &str,
    paused: bool,
) -> Result<(), String> {
    let c = client()?;
    let res = c
        .post(base(base_url, "/admin/user/account-paused"))
        .header("Authorization", bearer(token))
        .json(&serde_json::json!({ "userId": user_id, "paused": paused }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_delete_user(base_url: &str, token: &str, user_id: &str) -> Result<(), String> {
    let c = client()?;
    let path = format!("/admin/user/{}", urlencoding::encode(user_id));
    let res = c
        .delete(base(base_url, &path))
        .header("Authorization", bearer(token))
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({ "error": body }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}

pub fn admin_set_user_plan(
    base_url: &str,
    token: &str,
    user_id: &str,
    plan: &str,
    sessions_remaining: Option<i64>,
    plan_expires_at: Option<String>,
) -> Result<(), String> {
    let c = client()?;
    let body = serde_json::json!({
        "userId": user_id,
        "plan": plan,
        "sessionsRemaining": sessions_remaining,
        "planExpiresAt": plan_expires_at,
    });
    let res = c
        .post(base(base_url, "/admin/user/plan"))
        .header("Authorization", bearer(token))
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body_text = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let err: serde_json::Value =
            serde_json::from_str(&body_text).unwrap_or(serde_json::json!({ "error": body_text }));
        return Err(err.get("error").and_then(|v| v.as_str()).unwrap_or("Failed").to_string());
    }
    Ok(())
}
