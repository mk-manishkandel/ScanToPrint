use serde::Serialize;

/// Live updates pushed over WebSockets.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// A job was created/submitted/changed. Admin dashboards refresh it; the owning customer too.
    JobUpdated {
        job_id: i64,
        status: String,
        new: bool,
    },
    /// A print run changed state.
    PrintStatus {
        job_id: i64,
        run_id: i64,
        status: String,
        error: Option<String>,
    },
    /// A file finished converting (or failed).
    FileUpdated { job_id: i64, file_id: i64 },
}

impl Event {
    pub fn job_id(&self) -> i64 {
        match self {
            Event::JobUpdated { job_id, .. }
            | Event::PrintStatus { job_id, .. }
            | Event::FileUpdated { job_id, .. } => *job_id,
        }
    }
}
