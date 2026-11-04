//! Print worker: sends PDFs to printers one run at a time.
//! Windows: SumatraPDF (bundled next to the app). Other OSes: a mock printer that saves copies.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context;
use tokio::sync::mpsc;

use crate::events::Event;
use crate::services::{jobs_util, storage};
use crate::state::AppState;

const PRINT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, PartialEq)]
pub struct PrintSettings {
    pub range: Option<String>,
    pub copies: u32,
    pub color: bool,
    pub duplex: bool,
    pub paper: String,
}

/// SumatraPDF `-print-settings` value, e.g. `1-3,5,2x,duplexlong,monochrome,paper=A4`.
pub fn sumatra_settings(s: &PrintSettings) -> String {
    let mut parts = Vec::new();
    if let Some(r) = &s.range {
        parts.push(r.clone());
    }
    parts.push(format!("{}x", s.copies.max(1)));
    parts.push(if s.duplex { "duplexlong" } else { "simplex" }.into());
    parts.push(if s.color { "color" } else { "monochrome" }.into());
    parts.push(format!("paper={}", s.paper));
    parts.push("fit".into());
    parts.join(",")
}

pub fn sumatra_args(printer: &str, pdf: &Path, s: &PrintSettings) -> Vec<std::ffi::OsString> {
    vec![
        "-print-to".into(),
        printer.into(),
        "-print-settings".into(),
        sumatra_settings(s).into(),
        "-silent".into(),
        pdf.as_os_str().to_owned(),
    ]
}

pub const PAPER_SIZES: &[&str] = &["A4", "A3", "A5", "letter", "legal"];

#[derive(Debug, Clone)]
pub enum Backend {
    Sumatra(PathBuf),
    Mock(PathBuf),
    Missing,
}

impl Backend {
    pub fn detect(data_dir: &Path) -> Backend {
        if let Some(p) = std::env::var_os("SCANTOPRINT_SUMATRA").map(PathBuf::from)
            && p.exists()
        {
            return Backend::Sumatra(p);
        }
        // Tauri places sidecars next to the main executable (without the target suffix).
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(Path::to_path_buf))
        {
            for name in ["SumatraPDF.exe", "SumatraPDF-x86_64-pc-windows-msvc.exe"] {
                let p = dir.join(name);
                if p.exists() {
                    return Backend::Sumatra(p);
                }
            }
        }
        if cfg!(windows) {
            Backend::Missing
        } else {
            Backend::Mock(data_dir.join("mock-printer"))
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Backend::Sumatra(_) => "sumatra",
            Backend::Mock(_) => "mock",
            Backend::Missing => "missing",
        }
    }
}

pub fn start(state: AppState, mut rx: mpsc::UnboundedReceiver<i64>) {
    tokio::spawn(async move {
        // Runs interrupted by a restart are marked failed so staff can retry them.
        let _ = sqlx::query(
            "UPDATE print_runs SET status = 'failed', error = 'Interrupted (app restarted)' WHERE status = 'printing'",
        )
        .execute(&state.db)
        .await;
        if let Ok(queued) = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM print_runs WHERE status = 'queued' ORDER BY id",
        )
        .fetch_all(&state.db)
        .await
        {
            for id in queued {
                let _ = state.print_tx.send(id);
            }
        }
        while let Some(run_id) = rx.recv().await {
            // Isolated per run: a panic fails this run only, the worker keeps going.
            let st = state.clone();
            match tokio::spawn(async move { process(&st, run_id).await }).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::error!("print run {run_id}: {e:#}"),
                Err(join) => {
                    tracing::error!("print run {run_id} crashed: {join}");
                    if let Ok(Some(job_id)) =
                        sqlx::query_scalar::<_, i64>("SELECT job_id FROM print_runs WHERE id = ?")
                            .bind(run_id)
                            .fetch_optional(&state.db)
                            .await
                    {
                        let _ =
                            set_run(&state, run_id, job_id, "failed", Some("Internal error")).await;
                        let _ = update_job_after_run(&state, job_id).await;
                    }
                }
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct RunRow {
    job_id: i64,
    status: String,
    page_range: Option<String>,
    copies: i64,
    color: bool,
    duplex: bool,
    paper_size: String,
    pdf_path: Option<String>,
    system_name: Option<String>,
}

async fn process(st: &AppState, run_id: i64) -> anyhow::Result<()> {
    let Some(run) = sqlx::query_as::<_, RunRow>(
        "SELECT r.job_id, r.status, r.page_range, r.copies, r.color, r.duplex, r.paper_size,
                f.pdf_path, p.system_name
         FROM print_runs r
         JOIN job_files f ON f.id = r.file_id
         LEFT JOIN printers p ON p.id = r.printer_id
         WHERE r.id = ?",
    )
    .bind(run_id)
    .fetch_optional(&st.db)
    .await?
    else {
        return Ok(());
    };
    if run.status != "queued" {
        return Ok(());
    }
    // Claim the run atomically: a customer cancel between the read above and here wins.
    let claimed = sqlx::query(
        "UPDATE print_runs SET status = 'printing', updated_at = ? WHERE id = ? AND status = 'queued'",
    )
    .bind(crate::db::now())
    .bind(run_id)
    .execute(&st.db)
    .await?;
    if claimed.rows_affected() == 0 {
        return Ok(());
    }
    set_run(st, run_id, run.job_id, "printing", None).await?;
    jobs_util::set_status(&st.db, run.job_id, "printing").await?;
    st.emit(Event::JobUpdated {
        job_id: run.job_id,
        status: "printing".into(),
        new: false,
    });

    let settings = PrintSettings {
        range: run.page_range.clone(),
        copies: run.copies.max(1) as u32,
        color: run.color,
        duplex: run.duplex,
        paper: run.paper_size.clone(),
    };
    let result = match (&run.pdf_path, &run.system_name) {
        (Some(pdf_rel), Some(printer)) => {
            let pdf = storage::resolve(&st.config.data_dir, pdf_rel);
            send_to_printer(
                &Backend::detect(&st.config.data_dir),
                printer,
                &pdf,
                &settings,
            )
            .await
        }
        (None, _) => Err(anyhow::anyhow!("This file has no printable PDF")),
        (_, None) => Err(anyhow::anyhow!("The printer was removed")),
    };

    match result {
        Ok(()) => set_run(st, run_id, run.job_id, "done", None).await?,
        Err(e) => {
            tracing::warn!("print run {run_id} failed: {e:#}");
            set_run(st, run_id, run.job_id, "failed", Some(&format!("{e:#}"))).await?
        }
    }
    update_job_after_run(st, run.job_id).await
}

async fn send_to_printer(
    backend: &Backend,
    printer: &str,
    pdf: &Path,
    s: &PrintSettings,
) -> anyhow::Result<()> {
    if !pdf.exists() {
        anyhow::bail!("The file was deleted (older than the keep-files period)");
    }
    match backend {
        Backend::Sumatra(exe) => {
            let mut cmd = tokio::process::Command::new(exe);
            cmd.args(sumatra_args(printer, pdf, s)).kill_on_drop(true);
            crate::services::hide_window(&mut cmd);
            let status = tokio::time::timeout(PRINT_TIMEOUT, cmd.status())
                .await
                .context("Printer did not respond in time")?
                .context("Could not start the print program")?;
            if !status.success() {
                anyhow::bail!(
                    "Printing failed (code {:?}). Check the printer is on and has paper.",
                    status.code()
                );
            }
            Ok(())
        }
        Backend::Mock(dir) => {
            tokio::fs::create_dir_all(dir).await?;
            let stamp = chrono::Local::now().format("%H%M%S%3f");
            let name = pdf
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            tokio::fs::copy(pdf, dir.join(format!("{stamp}_{name}"))).await?;
            tokio::fs::write(
                dir.join(format!("{stamp}_{name}.txt")),
                format!("printer: {printer}\nsettings: {}\n", sumatra_settings(s)),
            )
            .await?;
            tracing::info!("[mock printer] {printer}: {name} ({})", sumatra_settings(s));
            Ok(())
        }
        Backend::Missing => {
            anyhow::bail!("The print component (SumatraPDF) is missing. Reinstall ScanToPrint.")
        }
    }
}

async fn set_run(
    st: &AppState,
    run_id: i64,
    job_id: i64,
    status: &str,
    error: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE print_runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(error)
        .bind(crate::db::now())
        .bind(run_id)
        .execute(&st.db)
        .await?;
    st.emit(Event::PrintStatus {
        job_id,
        run_id,
        status: status.into(),
        error: error.map(str::to_string),
    });
    Ok(())
}

/// When no runs are left in flight: any failure → failed; else self-print → done, staff → ready.
async fn update_job_after_run(st: &AppState, job_id: i64) -> anyhow::Result<()> {
    let (in_flight, failed): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(status IN ('queued','printing')), 0), COALESCE(SUM(status = 'failed'), 0)
         FROM print_runs WHERE job_id = ? AND id IN (
             SELECT MAX(id) FROM print_runs WHERE job_id = ? GROUP BY file_id)",
    )
    .bind(job_id)
    .bind(job_id)
    .fetch_one(&st.db)
    .await?;
    if in_flight > 0 {
        return Ok(());
    }
    let mode: Option<String> = sqlx::query_scalar("SELECT mode FROM jobs WHERE id = ?")
        .bind(job_id)
        .fetch_one(&st.db)
        .await?;
    let status = if failed > 0 {
        "failed"
    } else if mode.as_deref() == Some("self") {
        "done"
    } else {
        "ready"
    };
    jobs_util::set_status(&st.db, job_id, status).await?;
    st.emit(Event::JobUpdated {
        job_id,
        status: status.into(),
        new: false,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sumatra_settings() {
        let s = PrintSettings {
            range: Some("1-3,5".into()),
            copies: 2,
            color: false,
            duplex: true,
            paper: "A4".into(),
        };
        assert_eq!(
            sumatra_settings(&s),
            "1-3,5,2x,duplexlong,monochrome,paper=A4,fit"
        );
        let args = sumatra_args("HP LaserJet", Path::new("C:/x/a b.pdf"), &s);
        assert_eq!(args[0], "-print-to");
        assert_eq!(args[1], "HP LaserJet");
        assert_eq!(args.last().unwrap(), "C:/x/a b.pdf");
    }
}
