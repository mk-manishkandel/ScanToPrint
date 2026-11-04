//! First-run setup, login/logout, shop settings and staff accounts.

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{
    self, Owner, SESSION_COOKIE, Staff, User, clear_cookie, create_session, session_cookie,
    validate_password,
};
use crate::error::{AppError, AppResult, bad};
use crate::settings::Settings;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/shop", get(shop_info))
        .route("/api/setup/status", get(setup_status))
        .route("/api/setup", post(setup))
        .route("/api/admin/login", post(login))
        .route("/api/admin/logout", post(logout))
        .route("/api/admin/me", get(me))
        .route("/api/admin/settings", get(get_settings).put(put_settings))
        .route("/api/admin/users", get(list_users).post(create_user))
        .route(
            "/api/admin/users/{id}",
            patch(update_user).delete(delete_user),
        )
}

async fn shop_info(State(st): State<AppState>) -> AppResult<Json<Value>> {
    let s = Settings::load(&st.db).await?;
    let caps = crate::models::Capabilities::shop(&st.db).await?;
    Ok(Json(json!({
        "print_options": {
            "color": caps.color,
            "duplex": caps.duplex,
            "paper_sizes": caps.papers,
        },
        "prices": {
            "bw_single": s.price_bw_single,
            "bw_duplex": s.price_bw_duplex,
            "color_single": s.price_color_single,
            "color_duplex": s.price_color_duplex,
        },
        "shop_name": s.shop_name,
        "currency": s.currency,
        "max_file_mb": s.max_file_mb,
        "max_files_per_job": s.max_files_per_job,
        // What customers may send and how, per file group (Settings → File types).
        "file_types": crate::services::convert::FileGroup::ALL.iter().map(|g| {
            let r = s.file_types.rule(*g);
            json!({ "group": g, "submit": r.submit, "self_print": r.self_print, "extensions": g.extensions() })
        }).collect::<Vec<_>>(),
        "version": crate::VERSION,
    })))
}

async fn needs_setup(st: &AppState) -> AppResult<bool> {
    let owners: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'owner'")
        .fetch_one(&st.db)
        .await?;
    Ok(owners == 0)
}

async fn setup_status(State(st): State<AppState>) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "needs_setup": needs_setup(&st).await? })))
}

#[derive(Deserialize)]
struct SetupReq {
    shop_name: String,
    name: String,
    username: String,
    password: String,
}

/// Creates the owner account. Only works while no owner exists.
async fn setup(
    State(st): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    jar: CookieJar,
    Json(req): Json<SetupReq>,
) -> AppResult<(CookieJar, Json<User>)> {
    // Before an owner exists, anyone on the Wi-Fi could otherwise claim the shop.
    // The setup wizard runs in the app window on the shop PC, i.e. from localhost.
    if !addr.ip().is_loopback() {
        return Err(AppError::Forbidden);
    }
    if !needs_setup(&st).await? {
        return Err(AppError::Conflict("Setup is already complete".into()));
    }
    let settings = Settings {
        shop_name: req.shop_name.trim().to_string(),
        ..Settings::load(&st.db).await?
    };
    settings.validate()?;
    let user = insert_user(&st, &req.name, &req.username, &req.password, "owner").await?;
    // Two simultaneous setups: keep only the first owner.
    let first: i64 = sqlx::query_scalar("SELECT MIN(id) FROM users WHERE role = 'owner'")
        .fetch_one(&st.db)
        .await?;
    if first != user.id {
        sqlx::query("DELETE FROM users WHERE id = ?")
            .bind(user.id)
            .execute(&st.db)
            .await?;
        return Err(AppError::Conflict("Setup is already complete".into()));
    }
    settings.save(&st.db).await?;
    let token = create_session(&st.db, user.id).await?;
    Ok((jar.add(session_cookie(token)), Json(user)))
}

#[derive(Deserialize)]
struct LoginReq {
    username: String,
    password: String,
}

async fn login(
    State(st): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    jar: CookieJar,
    Json(req): Json<LoginReq>,
) -> AppResult<(CookieJar, Json<User>)> {
    if !st
        .limiter
        .check(addr.ip(), "login", 10, std::time::Duration::from_secs(300))
    {
        return Err(bad(
            "Too many login attempts. Wait 5 minutes and try again.",
        ));
    }
    if req.username.len() > 64 || req.password.len() > 256 {
        return Err(bad("Wrong username or password"));
    }
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = ? AND active = 1")
            .bind(req.username.trim())
            .fetch_optional(&st.db)
            .await?;
    // Always run one hash check so response time doesn't reveal whether a username exists.
    let hash = row
        .as_ref()
        .map(|(_, h)| h.as_str())
        .unwrap_or_else(|| auth::dummy_hash());
    let ok = auth::verify_password(&req.password, hash) && row.is_some();
    if !ok {
        // Slow down password guessing.
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        return Err(bad("Wrong username or password"));
    }
    let id = row.map(|(id, _)| id).unwrap_or_default();
    let user = get_user(&st, id).await?;
    let token = create_session(&st.db, id).await?;
    Ok((jar.add(session_cookie(token)), Json(user)))
}

async fn logout(State(st): State<AppState>, jar: CookieJar) -> AppResult<(CookieJar, Json<Value>)> {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        auth::delete_session(&st.db, c.value()).await?;
    }
    Ok((jar.remove(clear_cookie()), Json(json!({ "ok": true }))))
}

async fn me(Staff(user): Staff) -> Json<User> {
    Json(user)
}

async fn get_settings(State(st): State<AppState>, _: Staff) -> AppResult<Json<Settings>> {
    Ok(Json(Settings::load(&st.db).await?))
}

async fn put_settings(
    State(st): State<AppState>,
    _: Owner,
    Json(s): Json<Settings>,
) -> AppResult<Json<Settings>> {
    s.save(&st.db).await?;
    Ok(Json(s))
}

async fn list_users(State(st): State<AppState>, _: Owner) -> AppResult<Json<Vec<User>>> {
    Ok(Json(
        sqlx::query_as("SELECT id, name, username, role, active FROM users ORDER BY role, name")
            .fetch_all(&st.db)
            .await?,
    ))
}

#[derive(Deserialize)]
struct NewUser {
    name: String,
    username: String,
    password: String,
    role: String,
}

async fn create_user(
    State(st): State<AppState>,
    _: Owner,
    Json(req): Json<NewUser>,
) -> AppResult<Json<User>> {
    Ok(Json(
        insert_user(&st, &req.name, &req.username, &req.password, &req.role).await?,
    ))
}

#[derive(Deserialize)]
struct UserPatch {
    name: Option<String>,
    role: Option<String>,
    active: Option<bool>,
    password: Option<String>,
}

async fn update_user(
    State(st): State<AppState>,
    Owner(me): Owner,
    Path(id): Path<i64>,
    Json(p): Json<UserPatch>,
) -> AppResult<Json<User>> {
    let current = get_user(&st, id).await?;
    let demoting_owner = current.is_owner()
        && (p.role.as_deref().is_some_and(|r| r != "owner") || p.active == Some(false));
    if demoting_owner && owner_count(&st).await? <= 1 {
        return Err(bad("There must be at least one active owner"));
    }
    if id == me.id && p.active == Some(false) {
        return Err(bad("You can't deactivate your own account"));
    }
    if let Some(name) = p.name {
        let name = clean_name(&name)?;
        sqlx::query("UPDATE users SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&st.db)
            .await?;
    }
    if let Some(role) = p.role {
        check_role(&role)?;
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role)
            .bind(id)
            .execute(&st.db)
            .await?;
    }
    if let Some(active) = p.active {
        sqlx::query("UPDATE users SET active = ? WHERE id = ?")
            .bind(active)
            .bind(id)
            .execute(&st.db)
            .await?;
        if !active {
            sqlx::query("DELETE FROM sessions WHERE user_id = ?")
                .bind(id)
                .execute(&st.db)
                .await?;
        }
    }
    if let Some(pw) = p.password {
        validate_password(&pw)?;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(auth::hash_password(&pw)?)
            .bind(id)
            .execute(&st.db)
            .await?;
        // Log out everywhere else after a password change.
        if id != me.id {
            sqlx::query("DELETE FROM sessions WHERE user_id = ?")
                .bind(id)
                .execute(&st.db)
                .await?;
        }
    }
    Ok(Json(get_user(&st, id).await?))
}

async fn delete_user(
    State(st): State<AppState>,
    Owner(me): Owner,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    if id == me.id {
        return Err(bad("You can't delete your own account"));
    }
    let user = get_user(&st, id).await?;
    if user.is_owner() && owner_count(&st).await? <= 1 {
        return Err(bad("There must be at least one active owner"));
    }
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(&st.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn owner_count(st: &AppState) -> AppResult<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'owner' AND active = 1")
            .fetch_one(&st.db)
            .await?,
    )
}

async fn get_user(st: &AppState, id: i64) -> AppResult<User> {
    Ok(
        sqlx::query_as("SELECT id, name, username, role, active FROM users WHERE id = ?")
            .bind(id)
            .fetch_one(&st.db)
            .await?,
    )
}

fn clean_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(bad("Name must be 1–60 characters"));
    }
    Ok(name.to_string())
}

fn check_role(role: &str) -> AppResult<()> {
    match role {
        "owner" | "staff" => Ok(()),
        _ => Err(bad("Role must be owner or staff")),
    }
}

async fn insert_user(
    st: &AppState,
    name: &str,
    username: &str,
    password: &str,
    role: &str,
) -> AppResult<User> {
    let name = clean_name(name)?;
    let username = username.trim();
    if username.len() < 3
        || username.len() > 32
        || !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
    {
        return Err(bad(
            "Username must be 3–32 letters, numbers, dots or underscores",
        ));
    }
    validate_password(password)?;
    check_role(role)?;
    let res =
        sqlx::query("INSERT INTO users(name, username, password_hash, role) VALUES (?, ?, ?, ?)")
            .bind(name)
            .bind(username)
            .bind(auth::hash_password(password)?)
            .bind(role)
            .execute(&st.db)
            .await;
    match res {
        Ok(r) => get_user(st, r.last_insert_rowid()).await,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(AppError::Conflict("That username is already taken".into()))
        }
        Err(e) => Err(e.into()),
    }
}
