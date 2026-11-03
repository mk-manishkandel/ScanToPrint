use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::{broadcast, mpsc};

use crate::config::Config;
use crate::events::Event;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub events: broadcast::Sender<Event>,
    /// Queue a `job_files.id` for conversion.
    pub convert_tx: mpsc::UnboundedSender<i64>,
    /// Queue a `print_runs.id` for printing.
    pub print_tx: mpsc::UnboundedSender<i64>,
    pub limiter: Arc<RateLimiter>,
}

/// Receivers for the background workers; pass to [`Workers::start`].
pub struct Workers {
    convert_rx: mpsc::UnboundedReceiver<i64>,
    print_rx: mpsc::UnboundedReceiver<i64>,
}

impl AppState {
    pub fn new(db: SqlitePool, config: Config) -> (Self, Workers) {
        let (events, _) = broadcast::channel(256);
        let (convert_tx, convert_rx) = mpsc::unbounded_channel();
        let (print_tx, print_rx) = mpsc::unbounded_channel();
        (
            Self {
                db,
                config: Arc::new(config),
                events,
                convert_tx,
                print_tx,
                limiter: Arc::new(RateLimiter::default()),
            },
            Workers {
                convert_rx,
                print_rx,
            },
        )
    }

    /// Broadcast to connected dashboards / customers. No listeners is fine.
    pub fn emit(&self, event: Event) {
        let _ = self.events.send(event);
    }
}

impl Workers {
    pub fn start(self, state: &AppState) {
        crate::services::convert::start(state.clone(), self.convert_rx);
        crate::services::print::start(state.clone(), self.print_rx);
    }
}

/// Small fixed-window limiter per client IP (protects the open customer endpoints).
type Window = (Instant, u32);

#[derive(Default)]
pub struct RateLimiter {
    hits: Mutex<HashMap<(IpAddr, &'static str), Window>>,
}

impl RateLimiter {
    pub fn check(&self, ip: IpAddr, bucket: &'static str, max: u32, window: Duration) -> bool {
        let mut map = self.hits.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        if map.len() > 10_000 {
            map.retain(|_, (start, _)| now.duration_since(*start) < window);
        }
        let entry = map.entry((ip, bucket)).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= max
    }
}
