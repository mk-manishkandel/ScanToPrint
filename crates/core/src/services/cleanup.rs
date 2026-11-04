//! Deletes customer files older than the retention period. Job records stay for history.

use std::path::Path;
use std::time::Duration;

use crate::services::storage;
use crate::settings::Settings;
use crate::state::AppState;

pub fn start(state: AppState) {
    tokio::spawn(async move {
        // First run shortly after start-up, then every 6 hours.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            match run_once(&state).await {
                Ok(n) if n > 0 => tracing::info!("cleanup removed {n} old day folder(s)"),
                Ok(_) => {}
                Err(e) => tracing::warn!("cleanup failed: {e:#}"),
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

/// Returns the number of day folders removed.
pub async fn run_once(state: &AppState) -> anyhow::Result<usize> {
    let settings = Settings::load(&state.db).await?;
    let cutoff =
        chrono::Local::now().date_naive() - chrono::Duration::days(settings.retention_days as i64);
    let root = storage::storage_root(&state.config.data_dir);
    let removed = remove_older_than(&root, cutoff)?;
    remove_stale_tmp(
        &state.config.data_dir.join("tmp"),
        Duration::from_secs(3600),
    );
    Ok(removed)
}

/// Remove leftover conversion folders, but never ones a conversion may still be using.
fn remove_stale_tmp(tmp: &Path, older_than: Duration) {
    let Ok(entries) = std::fs::read_dir(tmp) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > older_than);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn remove_older_than(root: &Path, cutoff: chrono::NaiveDate) -> anyhow::Result<usize> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(0);
    };
    let mut n = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(date) = chrono::NaiveDate::parse_from_str(&name, "%Y-%m-%d") else {
            continue; // never touch folders we didn't create
        };
        if date < cutoff && entry.path().is_dir() {
            std::fs::remove_dir_all(entry.path())?;
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_fresh_tmp_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("conv-abc")).unwrap();
        remove_stale_tmp(dir.path(), Duration::from_secs(3600));
        assert!(dir.path().join("conv-abc").exists());
        remove_stale_tmp(dir.path(), Duration::ZERO);
        assert!(!dir.path().join("conv-abc").exists());
    }

    #[test]
    fn removes_only_old_dated_folders() {
        let dir = tempfile::tempdir().unwrap();
        for d in ["2026-01-01", "2026-11-01", "notes"] {
            std::fs::create_dir_all(dir.path().join(d).join("A-001")).unwrap();
        }
        let cutoff = chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert_eq!(remove_older_than(dir.path(), cutoff).unwrap(), 1);
        assert!(!dir.path().join("2026-01-01").exists());
        assert!(dir.path().join("2026-11-01").exists());
        assert!(dir.path().join("notes").exists());
    }
}
