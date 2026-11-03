//! Shared state between the desktop shell's auto-updater and the dashboard.
//! The shell (src-tauri) checks/installs; the dashboard shows status and asks to install.

use std::sync::Mutex;

use serde::Serialize;
use tokio::sync::Notify;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current: String,
    /// False when running without the desktop shell (dev server).
    pub supported: bool,
    pub available: Option<String>,
    pub notes: Option<String>,
    /// idle | checking | downloading | installing | error
    pub state: String,
    pub error: Option<String>,
    pub last_checked: Option<String>,
}

pub struct UpdateBridge {
    info: Mutex<UpdateInfo>,
    install: Notify,
}

impl UpdateBridge {
    pub fn new(supported: bool) -> Self {
        Self {
            info: Mutex::new(UpdateInfo {
                current: crate::VERSION.into(),
                supported,
                available: None,
                notes: None,
                state: "idle".into(),
                error: None,
                last_checked: None,
            }),
            install: Notify::new(),
        }
    }

    pub fn info(&self) -> UpdateInfo {
        self.info.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut UpdateInfo)) {
        f(&mut self.info.lock().unwrap_or_else(|p| p.into_inner()));
    }

    /// Called by the dashboard (owner) once nothing is printing.
    pub fn request_install(&self) {
        self.install.notify_one();
    }

    /// Awaited by the shell's updater loop.
    pub async fn install_requested(&self) {
        self.install.notified().await;
    }
}
