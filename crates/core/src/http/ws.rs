//! Live updates: `/ws/admin` (staff, all events) and `/ws/job/{id}?t=` (one customer job).

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::get;
use tokio::sync::broadcast::error::RecvError;

use crate::auth::Staff;
use crate::error::AppResult;
use crate::state::AppState;

use super::customer::{TokenQuery, authorize};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ws/admin", get(admin_ws))
        .route("/ws/job/{id}", get(job_ws))
}

async fn admin_ws(State(st): State<AppState>, _: Staff, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| pump(socket, st, None))
}

async fn job_ws(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> AppResult<Response> {
    authorize(&st, id, &headers, &q).await?;
    Ok(ws.on_upgrade(move |socket| pump(socket, st, Some(id))))
}

async fn pump(mut socket: WebSocket, st: AppState, only_job: Option<i64>) {
    let mut rx = st.events.subscribe();
    let mut ping = tokio::time::interval(std::time::Duration::from_secs(25));
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(ev) => {
                    if only_job.is_some_and(|id| id != ev.job_id()) {
                        continue;
                    }
                    let Ok(text) = serde_json::to_string(&ev) else { continue };
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                // Missed some events: tell the client to reload everything.
                Err(RecvError::Lagged(_)) => {
                    if socket.send(Message::Text(r#"{"type":"resync"}"#.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Closed) => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Default::default())).await.is_err() {
                    break;
                }
            }
        }
    }
}
