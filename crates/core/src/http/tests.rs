use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::config::Config;
use crate::state::AppState;

pub(crate) async fn test_app() -> (axum::Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = crate::db::open_memory().await.unwrap();
    let state = AppState::new(db, Config::new(dir.path().to_path_buf(), 0));
    (super::router(state), dir)
}

pub(crate) struct Resp {
    pub status: StatusCode,
    pub cookie: Option<String>,
    pub json: Value,
}

pub(crate) async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    cookie: Option<&str>,
) -> Resp {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Resp {
        status,
        cookie,
        json,
    }
}

/// Runs first-run setup and returns the owner's session cookie.
pub(crate) async fn setup_owner(app: &axum::Router) -> String {
    let r = call(
        app,
        "POST",
        "/api/setup",
        Some(json!({"shop_name":"Test Shop","name":"Owner","username":"owner","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);
    r.cookie.unwrap()
}

#[tokio::test]
async fn health_reports_version() {
    let (app, _d) = test_app().await;
    let r = call(&app, "GET", "/api/health", None, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json["version"], crate::VERSION);
}

#[tokio::test]
async fn unknown_api_route_is_404_not_spa() {
    let (app, _d) = test_app().await;
    assert_eq!(
        call(&app, "GET", "/api/nope", None, None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn setup_runs_once_then_login_works() {
    let (app, _d) = test_app().await;
    let r = call(&app, "GET", "/api/setup/status", None, None).await;
    assert_eq!(r.json["needs_setup"], true);

    let cookie = setup_owner(&app).await;
    let r = call(&app, "GET", "/api/shop", None, None).await;
    assert_eq!(r.json["shop_name"], "Test Shop");

    // Second setup is refused.
    let r = call(
        &app,
        "POST",
        "/api/setup",
        Some(json!({"shop_name":"X","name":"Evil","username":"evil","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::CONFLICT);

    let r = call(&app, "GET", "/api/admin/me", None, Some(&cookie)).await;
    assert_eq!(r.json["username"], "owner");

    let r = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"OWNER","password":"secret123"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.cookie.is_some());
}

#[tokio::test]
async fn admin_routes_need_login_and_staff_cannot_change_settings() {
    let (app, _d) = test_app().await;
    assert_eq!(
        call(&app, "GET", "/api/admin/me", None, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let owner = setup_owner(&app).await;
    let r = call(
        &app,
        "POST",
        "/api/admin/users",
        Some(json!({"name":"Ram","username":"ram","password":"pass1234","role":"staff"})),
        Some(&owner),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.json);

    let staff = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"ram","password":"pass1234"})),
        None,
    )
    .await
    .cookie
    .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/admin/settings", None, Some(&staff))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/api/admin/settings",
            Some(json!({"shop_name":"Hacked"})),
            Some(&staff)
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn wrong_password_rejected_and_last_owner_protected() {
    let (app, _d) = test_app().await;
    let owner = setup_owner(&app).await;
    let r = call(
        &app,
        "POST",
        "/api/admin/login",
        Some(json!({"username":"owner","password":"nope"})),
        None,
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let me = call(&app, "GET", "/api/admin/me", None, Some(&owner)).await;
    let id = me.json["id"].as_i64().unwrap();
    let r = call(
        &app,
        "PATCH",
        &format!("/api/admin/users/{id}"),
        Some(json!({"role":"staff"})),
        Some(&owner),
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}
