use argon2::password_hash::{PasswordHash, SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const SESSION_COOKIE: &str = "stp_session";
const SESSION_DAYS: i64 = 30;

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hashing password: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

/// 256-bit random token, hex encoded. Only its SHA-256 is stored.
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

pub fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 6 {
        return Err(crate::error::bad("Password must be at least 6 characters"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub role: String,
    pub active: bool,
}

impl User {
    pub fn is_owner(&self) -> bool {
        self.role == "owner"
    }
}

pub async fn create_session(db: &SqlitePool, user_id: i64) -> AppResult<String> {
    let token = random_token();
    let expires = (chrono::Utc::now() + chrono::Duration::days(SESSION_DAYS))
        .format("%Y-%m-%dT%H:%M:%.3fZ")
        .to_string();
    sqlx::query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(sha256_hex(&token))
        .bind(user_id)
        .bind(expires)
        .execute(db)
        .await?;
    // Opportunistic cleanup of expired sessions.
    sqlx::query("DELETE FROM sessions WHERE expires_at < ?")
        .bind(crate::db::now())
        .execute(db)
        .await?;
    Ok(token)
}

pub async fn delete_session(db: &SqlitePool, token: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(sha256_hex(token))
        .execute(db)
        .await?;
    Ok(())
}

pub async fn user_for_session(db: &SqlitePool, token: &str) -> AppResult<Option<User>> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT u.id, u.name, u.username, u.role, u.active
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1",
    )
    .bind(sha256_hex(token))
    .bind(crate::db::now())
    .fetch_optional(db)
    .await?)
}

pub fn session_cookie(token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time_days(SESSION_DAYS))
        .build()
}

pub fn clear_cookie() -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, "")).path("/").build()
}

fn time_days(days: i64) -> cookie::time::Duration {
    cookie::time::Duration::days(days)
}

/// Any logged-in staff member or owner.
pub struct Staff(pub User);

/// Logged-in owner only.
pub struct Owner(pub User);

impl FromRequestParts<AppState> for Staff {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or(AppError::Unauthorized)?;
        user_for_session(&state.db, &token)
            .await?
            .map(Staff)
            .ok_or(AppError::Unauthorized)
    }
}

impl FromRequestParts<AppState> for Owner {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let Staff(user) = Staff::from_request_parts(parts, state).await?;
        if user.is_owner() {
            Ok(Owner(user))
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let h = hash_password("secret123").unwrap();
        assert!(verify_password("secret123", &h));
        assert!(!verify_password("wrong", &h));
        assert!(!verify_password("x", "not-a-hash"));
    }

    #[test]
    fn tokens_are_unique_and_long() {
        let a = random_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_token());
    }
}
