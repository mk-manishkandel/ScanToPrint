mod account;
mod admin;
mod assets;
pub mod customer;
mod files;
mod ws;

use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router, routing::get};
use serde_json::{Value, json};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .merge(account::routes())
        .merge(customer::routes())
        .merge(admin::routes())
        .merge(ws::routes())
        .fallback(assets::serve)
        .layer(middleware::from_fn(same_origin_guard))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("SAMEORIGIN"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .with_state(state)
}

/// CSRF / cross-site WebSocket protection for staff endpoints: a browser always sends
/// `Origin` on these requests, and it must be this server. (Customer endpoints are already
/// protected by the secret job token, which another site can't know.)
async fn same_origin_guard(req: Request, next: Next) -> Response {
    let path = req.uri().path();
    let staff_area =
        path.starts_with("/api/admin") || path.starts_with("/api/setup") || path == "/ws/admin";
    let state_changing = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if staff_area && (state_changing || path.starts_with("/ws/")) && !origin_matches_host(&req) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Request blocked (wrong origin)" })),
        )
            .into_response();
    }
    next.run(req).await
}

fn origin_matches_host(req: &Request) -> bool {
    let Some(origin) = req.headers().get(header::ORIGIN) else {
        return true; // not a browser cross-site request (curl, tests, same-origin GET)
    };
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok());
    let origin_host = origin.to_str().ok().and_then(|o| {
        o.split_once("://")
            .map(|(_, rest)| rest.trim_end_matches('/'))
    });
    matches!((origin_host, host), (Some(o), Some(h)) if o.eq_ignore_ascii_case(h))
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": crate::VERSION }))
}

#[cfg(test)]
mod tests;
