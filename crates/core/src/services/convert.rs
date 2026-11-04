//! Background conversion of uploaded files to PDF + page counting.
//! Runs one file at a time (LibreOffice is not safe to run concurrently).

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context;
use tokio::sync::mpsc;

use crate::events::Event;
use crate::services::{pdf, storage};
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Pdf,
    Image,
    Office,
    Unsupported,
}

pub const PDF_EXT: &[&str] = &["pdf"];
pub const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];
pub const OFFICE_EXT: &[&str] = &[
    "doc", "docx", "odt", "rtf", "txt", "csv", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "pps",
    "ppsx", "wpd", "pages", "key", "numbers", "xps",
];
/// Accepted but not printable by us; staff can still download the original.
pub const OTHER_EXT: &[&str] = &["heic", "heif", "svg", "eps", "ai", "psd", "cdr", "zip"];

pub fn kind(ext: &str) -> Kind {
    if PDF_EXT.contains(&ext) {
        Kind::Pdf
    } else if IMAGE_EXT.contains(&ext) {
        Kind::Image
    } else if OFFICE_EXT.contains(&ext) {
        Kind::Office
    } else {
        Kind::Unsupported
    }
}

pub fn is_allowed(ext: &str) -> bool {
    kind(ext) != Kind::Unsupported || OTHER_EXT.contains(&ext)
}

const OFFICE_TIMEOUT: Duration = Duration::from_secs(120);
/// Page counting / image conversion should take seconds; anything longer is a hostile file.
const BLOCKING_TIMEOUT: Duration = Duration::from_secs(60);

/// Run CPU-bound file work off the async runtime, with a time limit.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    tokio::time::timeout(BLOCKING_TIMEOUT, tokio::task::spawn_blocking(f))
        .await
        .context("processing timed out")?
        .context("processing crashed")?
}

/// Start the worker. Also re-queues files left pending by a previous run.
pub fn start(state: AppState, mut rx: mpsc::UnboundedReceiver<i64>) {
    tokio::spawn(async move {
        if let Ok(pending) = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM job_files WHERE conversion_status = 'pending'",
        )
        .fetch_all(&state.db)
        .await
        {
            for id in pending {
                let _ = state.convert_tx.send(id);
            }
        }
        while let Some(file_id) = rx.recv().await {
            // Each file runs in its own task so a panic (e.g. a malformed file tripping a
            // parser bug) fails that file only and never stops the worker.
            let st = state.clone();
            let outcome = tokio::spawn(async move { process(&st, file_id).await }).await;
            match outcome {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::error!("conversion of file {file_id} failed: {e:#}"),
                Err(join) => {
                    tracing::error!("conversion of file {file_id} crashed: {join}");
                    let _ = mark_failed(
                        &state,
                        file_id,
                        "This file couldn't be read. It may be damaged.",
                    )
                    .await;
                }
            }
        }
    });
}

async fn process(st: &AppState, file_id: i64) -> anyhow::Result<()> {
    let row: Option<(i64, String, String)> = sqlx::query_as(
        "SELECT job_id, original_path, conversion_status FROM job_files WHERE id = ?",
    )
    .bind(file_id)
    .fetch_optional(&st.db)
    .await?;
    let Some((job_id, original_rel, status)) = row else {
        return Ok(()); // deleted meanwhile
    };
    if status != "pending" {
        return Ok(());
    }
    let root = storage::storage_root(&st.config.data_dir);
    let original = root.join(&original_rel);
    let ext = storage::extension(&original_rel);

    let result = convert_one(st, &root, &original, &original_rel, kind(&ext)).await;
    match result {
        Ok(Some((pdf_rel, pages))) => {
            sqlx::query(
                "UPDATE job_files SET pdf_path = ?, page_count = ?, conversion_status = 'ok', error = NULL WHERE id = ?",
            )
            .bind(pdf_rel)
            .bind(pages as i64)
            .bind(file_id)
            .execute(&st.db)
            .await?;
        }
        Ok(None) => {
            sqlx::query(
                "UPDATE job_files SET conversion_status = 'unsupported', error = ? WHERE id = ?",
            )
            .bind("This file type can't be printed automatically. The shop can still open it.")
            .bind(file_id)
            .execute(&st.db)
            .await?;
        }
        Err(e) => {
            tracing::warn!("file {file_id}: {e:#}");
            sqlx::query(
                "UPDATE job_files SET conversion_status = 'failed', error = ? WHERE id = ?",
            )
            .bind(friendly_error(&e))
            .bind(file_id)
            .execute(&st.db)
            .await?;
        }
    }
    crate::services::jobs_util::recompute_pages(&st.db, job_id).await?;
    st.emit(Event::FileUpdated { job_id, file_id });
    Ok(())
}

async fn mark_failed(st: &AppState, file_id: i64, msg: &str) -> anyhow::Result<()> {
    let job_id: Option<i64> = sqlx::query_scalar("SELECT job_id FROM job_files WHERE id = ?")
        .bind(file_id)
        .fetch_optional(&st.db)
        .await?;
    sqlx::query("UPDATE job_files SET conversion_status = 'failed', error = ? WHERE id = ?")
        .bind(msg)
        .bind(file_id)
        .execute(&st.db)
        .await?;
    if let Some(job_id) = job_id {
        st.emit(Event::FileUpdated { job_id, file_id });
    }
    Ok(())
}

fn friendly_error(e: &anyhow::Error) -> String {
    let msg = format!("{e:#}");
    if msg.contains("LibreOffice is not installed") {
        "The shop computer can't convert this file type yet (LibreOffice missing). The shop can still open it.".into()
    } else if msg.contains("timed out") {
        "Converting this file took too long. Try saving it as PDF.".into()
    } else {
        "This file couldn't be read. It may be damaged or password-protected.".into()
    }
}

/// Returns (pdf path relative to storage root, page count), or None if unsupported.
async fn convert_one(
    st: &AppState,
    root: &Path,
    original: &Path,
    original_rel: &str,
    kind: Kind,
) -> anyhow::Result<Option<(String, u32)>> {
    // .../<job>/original/<name>  →  .../<job>/pdf/<stem>.pdf
    let job_rel = Path::new(original_rel)
        .parent()
        .and_then(Path::parent)
        .context("bad stored path")?
        .to_path_buf();
    let stem = original
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let pdf_rel = job_rel.join("pdf").join(format!("{stem}.pdf"));
    let pdf_abs = root.join(&pdf_rel);
    std::fs::create_dir_all(pdf_abs.parent().context("bad path")?)?;
    let pdf_rel_str = pdf_rel.to_string_lossy().replace('\\', "/");

    match kind {
        Kind::Pdf => {
            let src = original.to_path_buf();
            let pages = blocking(move || pdf::page_count(&src)).await?;
            tokio::fs::copy(original, &pdf_abs).await?;
            Ok(Some((pdf_rel_str, pages)))
        }
        Kind::Image => {
            let (src, dest) = (original.to_path_buf(), pdf_abs.clone());
            let pages = blocking(move || pdf::image_to_pdf(&src, &dest)).await?;
            Ok(Some((pdf_rel_str, pages)))
        }
        Kind::Office => {
            office_to_pdf(&st.config.data_dir, original, &pdf_abs).await?;
            let dest = pdf_abs.clone();
            let pages = blocking(move || pdf::page_count(&dest)).await?;
            Ok(Some((pdf_rel_str, pages)))
        }
        Kind::Unsupported => Ok(None),
    }
}

async fn office_to_pdf(data_dir: &Path, src: &Path, dest: &Path) -> anyhow::Result<()> {
    let soffice = find_soffice().context("LibreOffice is not installed")?;
    let out_dir = tempdir_in(data_dir)?;
    let profile = data_dir.join("lo-profile");
    let profile_url = format!(
        "file:///{}",
        profile
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    );

    let mut cmd = tokio::process::Command::new(&soffice);
    cmd.arg(format!("-env:UserInstallation={profile_url}"))
        .args(["--headless", "--norestore", "--nolockcheck", "--nodefault"])
        .args(["--convert-to", "pdf", "--outdir"])
        .arg(&out_dir)
        .arg(src)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    crate::services::hide_window(&mut cmd);

    let child = cmd.spawn().context("starting LibreOffice")?;
    let out = tokio::time::timeout(OFFICE_TIMEOUT, child.wait_with_output())
        .await
        .context("LibreOffice timed out")??;

    let produced = std::fs::read_dir(&out_dir)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")));
    let result = match produced {
        Some(p) => std::fs::rename(&p, dest)
            .or_else(|_| std::fs::copy(&p, dest).map(|_| ()))
            .context("saving converted PDF"),
        None => Err(anyhow::anyhow!(
            "LibreOffice produced no PDF (exit {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        )),
    };
    let _ = std::fs::remove_dir_all(&out_dir);
    result
}

fn tempdir_in(data_dir: &Path) -> anyhow::Result<PathBuf> {
    let dir = data_dir.join("tmp").join(format!(
        "conv-{}",
        crate::auth::random_token().get(..12).unwrap_or("x")
    ));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Locate LibreOffice's `soffice` executable.
pub fn find_soffice() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("SCANTOPRINT_SOFFICE").map(PathBuf::from)
        && p.exists()
    {
        return Some(p);
    }
    let candidates = soffice_candidates();
    if let Some(found) = candidates.into_iter().find(|p| p.exists()) {
        return Some(found);
    }
    let names: &[&str] = if cfg!(windows) {
        &["soffice.exe"]
    } else {
        &["soffice", "libreoffice"]
    };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
            .find(|p| p.exists())
    })
}

#[cfg(windows)]
fn soffice_candidates() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join(r"LibreOffice\program\soffice.exe"))
        .collect()
}

#[cfg(target_os = "macos")]
fn soffice_candidates() -> Vec<PathBuf> {
    vec!["/Applications/LibreOffice.app/Contents/MacOS/soffice".into()]
}

#[cfg(not(any(windows, target_os = "macos")))]
fn soffice_candidates() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(kind("pdf"), Kind::Pdf);
        assert_eq!(kind("jpeg"), Kind::Image);
        assert_eq!(kind("docx"), Kind::Office);
        assert_eq!(kind("exe"), Kind::Unsupported);
        assert!(is_allowed("heic"));
        assert!(!is_allowed("exe"));
        assert!(!is_allowed("bat"));
        assert!(
            !is_allowed("html"),
            "HTML could run scripts when opened on the shop PC"
        );
    }
}
