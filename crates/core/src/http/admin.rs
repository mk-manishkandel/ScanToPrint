//! Staff dashboard API: job queue, files, printing, printers, system status.

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{Owner, Staff};
use crate::error::{AppError, AppResult, bad};
use crate::events::Event;
use crate::models::{self, Job, JobDetail, JobFile, PRINTER_COLS, PrintReq, Printer};
use crate::services::print::{Backend, PAPER_SIZES};
use crate::services::{cleanup, convert, network, printers, storage};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/admin/jobs", get(list_jobs))
        .route("/api/admin/jobs/{id}", get(get_job).patch(update_job))
        .route("/api/admin/jobs/{id}/print", post(print_job))
        .route("/api/admin/jobs/{id}/quote", post(quote_job))
        .route("/api/admin/files/{fid}/original", get(file_original))
        .route("/api/admin/files/{fid}/pdf", get(file_pdf))
        .route("/api/admin/files/{fid}/open", post(open_on_pc))
        .route("/api/admin/files/{fid}/reveal", post(show_in_folder))
        .route("/api/admin/storage/open", post(open_storage))
        .route("/api/admin/files/{fid}/reconvert", post(reconvert))
        .route("/api/admin/printers", get(list_printers))
        .route("/api/admin/printers/scan", post(scan_printers))
        .route(
            "/api/admin/printers/{id}",
            patch(update_printer).delete(delete_printer),
        )
        .route("/api/admin/system", get(system))
        .route("/api/admin/cleanup", post(cleanup_now))
        .route("/api/admin/qr.svg", get(qr_svg))
        .route("/api/admin/update", get(update_info))
        .route("/api/admin/update/install", post(update_install))
}

#[derive(Deserialize)]
struct JobQuery {
    /// "active" (default) = the live queue; "all" = history.
    view: Option<String>,
    q: Option<String>,
    date: Option<String>,
    limit: Option<i64>,
}

#[derive(serde::Serialize)]
struct JobListItem {
    #[serde(flatten)]
    job: Job,
    files: Vec<JobFile>,
}

async fn list_jobs(
    State(st): State<AppState>,
    _: Staff,
    Query(q): Query<JobQuery>,
) -> AppResult<Json<Vec<JobListItem>>> {
    let mut sql = format!("SELECT {} FROM jobs WHERE 1=1", models::JOB_COLS);
    let mut binds: Vec<String> = Vec::new();
    match q.view.as_deref().unwrap_or("active") {
        "active" => sql.push_str(
            " AND (status IN ('submitted','printing','ready','failed') OR (status = 'queued'))",
        ),
        "all" => sql.push_str(" AND status != 'uploaded'"),
        _ => return Err(bad("unknown view")),
    }
    if let Some(date) = q.date.filter(|d| !d.is_empty()) {
        if chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err() {
            return Err(bad("Invalid date"));
        }
        sql.push_str(" AND storage_dir LIKE ?");
        binds.push(format!("{date}/%"));
    }
    if let Some(text) =
        q.q.map(|s| s.trim().chars().take(100).collect::<String>())
            .filter(|s| !s.is_empty())
    {
        sql.push_str(" AND (code LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)");
        let like = format!("%{text}%");
        binds.extend([like.clone(), like.clone(), like]);
    }
    sql.push_str(" ORDER BY id DESC LIMIT ?");
    let mut query = sqlx::query_as::<_, Job>(&sql);
    for b in &binds {
        query = query.bind(b);
    }
    let jobs = query
        .bind(q.limit.unwrap_or(200).clamp(1, 1000))
        .fetch_all(&st.db)
        .await?;

    let mut out = Vec::with_capacity(jobs.len());
    for job in jobs {
        let files = sqlx::query_as(&format!(
            "SELECT {} FROM job_files WHERE job_id = ? ORDER BY id",
            models::FILE_COLS
        ))
        .bind(job.id)
        .fetch_all(&st.db)
        .await?;
        out.push(JobListItem { job, files });
    }
    Ok(Json(out))
}

async fn get_job(
    State(st): State<AppState>,
    _: Staff,
    Path(id): Path<i64>,
) -> AppResult<Json<JobDetail>> {
    Ok(Json(models::job_detail(&st.db, id).await?))
}

#[derive(Deserialize)]
struct JobPatch {
    status: String,
}

async fn update_job(
    State(st): State<AppState>,
    Staff(user): Staff,
    Path(id): Path<i64>,
    Json(p): Json<JobPatch>,
) -> AppResult<Json<JobDetail>> {
    const ALLOWED: &[&str] = &[
        "submitted",
        "printing",
        "ready",
        "done",
        "collected",
        "cancelled",
    ];
    if !ALLOWED.contains(&p.status.as_str()) {
        return Err(bad("Invalid status"));
    }
    let res = sqlx::query("UPDATE jobs SET status = ?, handled_by = ?, updated_at = ? WHERE id = ? AND status != 'uploaded'")
        .bind(&p.status)
        .bind(user.id)
        .bind(crate::db::now())
        .bind(id)
        .execute(&st.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    st.emit(Event::JobUpdated {
        job_id: id,
        status: p.status,
        new: false,
    });
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn quote_job(
    State(st): State<AppState>,
    _: Staff,
    Path(id): Path<i64>,
    Json(req): Json<PrintReq>,
) -> AppResult<Json<models::PrintPlan>> {
    Ok(Json(models::plan_print(&st.db, id, &req, false).await?))
}

async fn print_job(
    State(st): State<AppState>,
    Staff(user): Staff,
    Path(id): Path<i64>,
    Json(req): Json<PrintReq>,
) -> AppResult<Json<JobDetail>> {
    let plan = models::plan_print(&st.db, id, &req, false).await?;
    sqlx::query("UPDATE jobs SET handled_by = ? WHERE id = ?")
        .bind(user.id)
        .bind(id)
        .execute(&st.db)
        .await?;
    models::enqueue_plan(&st, id, &plan, "staff", None).await?;
    st.emit(Event::JobUpdated {
        job_id: id,
        status: "queued".into(),
        new: false,
    });
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn file_paths(st: &AppState, fid: i64) -> AppResult<(String, String, Option<String>)> {
    Ok(
        sqlx::query_as("SELECT original_name, original_path, pdf_path FROM job_files WHERE id = ?")
            .bind(fid)
            .fetch_one(&st.db)
            .await?,
    )
}

async fn file_original(
    State(st): State<AppState>,
    _: Staff,
    Path(fid): Path<i64>,
) -> AppResult<Response> {
    let (name, orig, _) = file_paths(&st, fid).await?;
    let mime = mime_guess::from_path(&orig)
        .first_or_octet_stream()
        .to_string();
    super::files::send_file(
        &storage::resolve(&st.config.data_dir, &orig),
        &mime,
        Some(&name),
    )
    .await
}

async fn file_pdf(
    State(st): State<AppState>,
    _: Staff,
    Path(fid): Path<i64>,
) -> AppResult<Response> {
    let (_, _, pdf) = file_paths(&st, fid).await?;
    let pdf = pdf.ok_or(AppError::NotFound)?;
    super::files::send_file(
        &storage::resolve(&st.config.data_dir, &pdf),
        "application/pdf",
        None,
    )
    .await
}

/// Opens the original file with its Windows app (Word, Photos…). Only from the shop PC itself.
async fn open_on_pc(
    State(st): State<AppState>,
    _: Staff,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(fid): Path<i64>,
) -> AppResult<Json<Value>> {
    let path = local_file(&st, addr, fid).await?;
    launch(&path, false)?;
    Ok(Json(json!({ "ok": true })))
}

/// Opens the job's folder in Explorer with the file selected. Only from the shop PC itself.
async fn show_in_folder(
    State(st): State<AppState>,
    _: Staff,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(fid): Path<i64>,
) -> AppResult<Json<Value>> {
    let path = local_file(&st, addr, fid).await?;
    launch(&path, true)?;
    Ok(Json(json!({ "ok": true })))
}

/// Opens the folder where customer files are kept. Only from the shop PC itself.
async fn open_storage(
    State(st): State<AppState>,
    _: Staff,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> AppResult<Json<Value>> {
    if !addr.ip().is_loopback() {
        return Err(bad("The folder can only be opened on the shop computer."));
    }
    let dir = storage::storage_root(&st.config.data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(e.into()))?;
    launch(&dir, false)?;
    Ok(Json(json!({ "ok": true })))
}

async fn local_file(st: &AppState, addr: SocketAddr, fid: i64) -> AppResult<std::path::PathBuf> {
    if !addr.ip().is_loopback() {
        return Err(bad(
            "Files can only be opened this way on the shop computer. Use Download instead.",
        ));
    }
    let (_, orig, _) = file_paths(st, fid).await?;
    let path = storage::resolve(&st.config.data_dir, &orig);
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    Ok(path)
}

/// Open `path` with its default app, or (`reveal`) show it selected in the file manager.
fn launch(path: &std::path::Path, reveal: bool) -> AppResult<()> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("explorer.exe");
        if reveal {
            // Explorer parses its own command line: `/select,"C:\path\file"` must be one
            // argument with the quotes exactly here, so pass it raw.
            c.raw_arg(format!("/select,\"{}\"", path.display()));
        } else {
            c.arg(path);
        }
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("open");
        if reveal {
            c.arg("-R");
        }
        c.arg(path);
        c
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("xdg-open");
        c.arg(if reveal {
            path.parent().unwrap_or(path)
        } else {
            path
        });
        c
    };
    cmd.spawn().map_err(|e| AppError::Internal(e.into()))?;
    Ok(())
}

/// Try converting a file again (e.g. after installing LibreOffice).
async fn reconvert(
    State(st): State<AppState>,
    _: Staff,
    Path(fid): Path<i64>,
) -> AppResult<Json<Value>> {
    let res = sqlx::query(
        "UPDATE job_files SET conversion_status = 'pending', error = NULL WHERE id = ? AND conversion_status = 'failed'",
    )
    .bind(fid)
    .execute(&st.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(bad("Only files that failed to convert can be retried"));
    }
    let _ = st.convert_tx.send(fid);
    Ok(Json(json!({ "ok": true })))
}

async fn list_printers(State(st): State<AppState>, _: Staff) -> AppResult<Json<Vec<Value>>> {
    let printers: Vec<Printer> = sqlx::query_as(&format!(
        "SELECT {PRINTER_COLS} FROM printers ORDER BY display_name"
    ))
    .fetch_all(&st.db)
    .await?;
    let installed = printers::list_system_printers().await.unwrap_or_default();
    Ok(Json(
        printers
            .into_iter()
            .map(|p| {
                let mut v = serde_json::to_value(&p).unwrap_or_default();
                v["paper_sizes"] = json!(p.papers());
                v["installed"] = json!(installed.iter().any(|s| s.name == p.system_name));
                v
            })
            .collect(),
    ))
}

/// Adds any newly installed Windows printers (inactive until the owner turns them on).
async fn scan_printers(State(st): State<AppState>, _: Owner) -> AppResult<Json<Value>> {
    let found = printers::list_system_printers()
        .await
        .map_err(|e| bad(format!("Couldn't read the printer list: {e}")))?;
    let mut added = 0;
    for p in &found {
        // New printers start with what Windows reports; existing ones keep the owner's choices.
        let r = sqlx::query(
            "INSERT OR IGNORE INTO printers(system_name, display_name, supports_color, supports_duplex)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&p.name)
        .bind(&p.name)
        .bind(p.color)
        .bind(p.duplex)
        .execute(&st.db)
        .await?;
        added += r.rows_affected();
    }
    Ok(Json(json!({ "found": found.len(), "added": added })))
}

#[derive(Deserialize)]
struct PrinterPatch {
    display_name: Option<String>,
    is_active: Option<bool>,
    allow_self_print: Option<bool>,
    supports_color: Option<bool>,
    supports_duplex: Option<bool>,
    paper_sizes: Option<Vec<String>>,
}

async fn update_printer(
    State(st): State<AppState>,
    _: Owner,
    Path(id): Path<i64>,
    Json(p): Json<PrinterPatch>,
) -> AppResult<Json<Printer>> {
    let mut cur: Printer =
        sqlx::query_as(&format!("SELECT {PRINTER_COLS} FROM printers WHERE id = ?"))
            .bind(id)
            .fetch_one(&st.db)
            .await?;
    if let Some(n) = p.display_name {
        let n = n.trim().to_string();
        if n.is_empty() || n.chars().count() > 60 {
            return Err(bad("Name must be 1–60 characters"));
        }
        cur.display_name = n;
    }
    if let Some(sizes) = p.paper_sizes {
        if sizes.is_empty() || sizes.iter().any(|s| !PAPER_SIZES.contains(&s.as_str())) {
            return Err(bad("Choose at least one valid paper size"));
        }
        cur.paper_sizes = serde_json::to_string(&sizes).map_err(anyhow::Error::from)?;
    }
    cur.is_active = p.is_active.unwrap_or(cur.is_active);
    cur.allow_self_print = p.allow_self_print.unwrap_or(cur.allow_self_print);
    cur.supports_color = p.supports_color.unwrap_or(cur.supports_color);
    cur.supports_duplex = p.supports_duplex.unwrap_or(cur.supports_duplex);
    sqlx::query(
        "UPDATE printers SET display_name = ?, is_active = ?, allow_self_print = ?, supports_color = ?,
                             supports_duplex = ?, paper_sizes = ? WHERE id = ?",
    )
    .bind(&cur.display_name)
    .bind(cur.is_active)
    .bind(cur.allow_self_print)
    .bind(cur.supports_color)
    .bind(cur.supports_duplex)
    .bind(&cur.paper_sizes)
    .bind(id)
    .execute(&st.db)
    .await?;
    Ok(Json(cur))
}

async fn delete_printer(
    State(st): State<AppState>,
    _: Owner,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM printers WHERE id = ?")
        .bind(id)
        .execute(&st.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn system(State(st): State<AppState>, _: Staff) -> AppResult<Json<Value>> {
    let port = st.config.bind.port();
    Ok(Json(json!({
        "version": crate::VERSION,
        "portal_urls": network::portal_urls(port),
        "port": port,
        "libreoffice": convert::find_soffice().is_some(),
        "print_backend": Backend::detect(&st.config.data_dir).label(),
        "data_dir": st.config.data_dir.display().to_string(),
        "storage_dir": storage::storage_root(&st.config.data_dir).display().to_string(),
    })))
}

async fn cleanup_now(State(st): State<AppState>, _: Owner) -> AppResult<Json<Value>> {
    let removed = cleanup::run_once(&st).await?;
    Ok(Json(json!({ "removed_days": removed })))
}

#[derive(Deserialize)]
struct QrQuery {
    url: String,
}

async fn qr_svg(_: Staff, Query(q): Query<QrQuery>) -> AppResult<Response> {
    if !(q.url.starts_with("http://") || q.url.starts_with("https://")) || q.url.len() > 300 {
        return Err(bad("Invalid URL"));
    }
    let code = qrcode::QrCode::with_error_correction_level(q.url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| bad(e.to_string()))?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(600, 600)
        .quiet_zone(true)
        .build();
    Ok(([(header::CONTENT_TYPE, "image/svg+xml")], svg).into_response())
}

async fn update_info(State(st): State<AppState>, _: Staff) -> Json<crate::update::UpdateInfo> {
    Json(st.config.updates.info())
}

/// Owner asks to install a downloaded-ready update. Refused while anything is in progress.
async fn update_install(State(st): State<AppState>, _: Owner) -> AppResult<Json<Value>> {
    let info = st.config.updates.info();
    if !info.supported || info.available.is_none() {
        return Err(bad("No update is available"));
    }
    let (printing, converting): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM print_runs WHERE status IN ('queued','printing')),
                (SELECT COUNT(*) FROM job_files WHERE conversion_status = 'pending')",
    )
    .fetch_one(&st.db)
    .await?;
    if printing > 0 || converting > 0 {
        return Err(bad(
            "Wait until current printing and file preparation finish, then try again.",
        ));
    }
    st.config.updates.request_install();
    Ok(Json(json!({ "ok": true })))
}
