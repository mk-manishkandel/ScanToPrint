//! Serves the built React app (`web/dist`), compiled into the binary.

use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../web/dist"]
#[allow_missing = true]
struct WebDist;

/// Only our own scripts may run; no plugins; not embeddable by other sites.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
     img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-src 'self'; \
     object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // Unknown API/websocket paths must 404, not return the SPA.
    if path.starts_with("api/") || path.starts_with("ws/") {
        return StatusCode::NOT_FOUND.into_response();
    }

    if let Some(file) = WebDist::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let cache = if path.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        let mut resp = (
            [
                (header::CONTENT_TYPE, mime.as_ref().to_string()),
                (header::CACHE_CONTROL, cache.to_string()),
            ],
            file.data,
        )
            .into_response();
        if path.ends_with(".html") {
            resp.headers_mut().insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static(CSP),
            );
        }
        return resp;
    }

    // Client-side routes (/, /job/..., /admin/...) all load index.html.
    match WebDist::get("index.html") {
        Some(index) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
                (header::CONTENT_SECURITY_POLICY, CSP),
            ],
            index.data,
        )
            .into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Web UI not built. Run `npm run web:build`.",
        )
            .into_response(),
    }
}
