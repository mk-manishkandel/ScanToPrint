//! Streaming stored files back to the browser.

use std::path::Path;

use axum::body::Body;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use tokio_util::io::ReaderStream;

use crate::error::{AppError, AppResult};

pub async fn send_file(
    path: &Path,
    content_type: &str,
    download_name: Option<&str>,
) -> AppResult<Response> {
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(AppError::NotFound),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata().await?.len();
    let disposition = match download_name {
        Some(name) => format!("attachment; filename*=UTF-8''{}", percent_encode(name)),
        None => "inline".into(),
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "private, no-store".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}
