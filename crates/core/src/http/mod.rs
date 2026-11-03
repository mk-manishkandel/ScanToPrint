mod account;
mod admin;
mod assets;
pub mod customer;
mod files;
mod ws;

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, header};
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
        .layer(DefaultBodyLimit::max(1024 * 1024))
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

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": crate::VERSION }))
}

#[cfg(test)]
mod tests;
