//! Auto-update: checks GitHub Releases (signed with the ScanToPrint updater key) at start-up,
//! every 6 hours, and whenever the owner clicks "Check for updates". Installation only happens when the owner clicks "Install" in the dashboard
//! (the server refuses while anything is printing).

use std::sync::Arc;
use std::time::Duration;

use scantoprint_core::update::UpdateBridge;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

pub fn start(app: AppHandle, bridge: Arc<UpdateBridge>) {
    if cfg!(debug_assertions) {
        return; // dev builds never update themselves
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        let mut pending: Option<Update> = None;
        loop {
            if pending.is_none() {
                pending = check(&app, &bridge).await;
            }
            tokio::select! {
                _ = tokio::time::sleep(CHECK_EVERY) => {}
                // Manual check: forget what we found, so a newer release replaces it.
                _ = bridge.check_requested() => pending = None,
                _ = bridge.install_requested() => {
                    if let Some(update) = pending.take() {
                        install(&app, &bridge, update).await;
                    }
                }
            }
        }
    });
}

async fn check(app: &AppHandle, bridge: &UpdateBridge) -> Option<Update> {
    bridge.update(|i| i.state = "checking".into());
    let result = match app.updater() {
        Ok(u) => u.check().await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    let now = unix_now();
    match result {
        Ok(Some(update)) => {
            tracing::info!("update available: {}", update.version);
            bridge.update(|i| {
                i.state = "idle".into();
                i.available = Some(update.version.clone());
                i.notes = update.body.clone();
                i.error = None;
                i.last_checked = Some(now);
            });
            Some(update)
        }
        Ok(None) => {
            bridge.update(|i| {
                i.state = "idle".into();
                i.available = None;
                i.error = None;
                i.last_checked = Some(now);
            });
            None
        }
        Err(e) => {
            // Usually just "no internet" — not worth alarming the shop about.
            tracing::warn!("update check failed: {e}");
            bridge.update(|i| {
                i.state = "idle".into();
                i.last_checked = Some(now);
            });
            None
        }
    }
}

async fn install(app: &AppHandle, bridge: &UpdateBridge, update: Update) {
    bridge.update(|i| i.state = "downloading".into());
    let res = update
        .download_and_install(|_chunk, _total| {}, || {})
        .await;
    match res {
        Ok(()) => {
            tracing::info!("update installed, restarting");
            bridge.update(|i| i.state = "installing".into());
            app.restart();
        }
        Err(e) => {
            tracing::error!("update failed: {e}");
            bridge.update(|i| {
                i.state = "error".into();
                i.error = Some(format!("Update failed: {e}"));
            });
        }
    }
}

fn unix_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}
