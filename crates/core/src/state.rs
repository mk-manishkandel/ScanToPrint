use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::events::Event;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub events: broadcast::Sender<Event>,
}

impl AppState {
    pub fn new(db: SqlitePool, config: Config) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            db,
            config: Arc::new(config),
            events,
        }
    }

    /// Broadcast to connected dashboards / customers. No listeners is fine.
    pub fn emit(&self, event: Event) {
        let _ = self.events.send(event);
    }
}
