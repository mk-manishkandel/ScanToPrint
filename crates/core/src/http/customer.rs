//! Public customer endpoints. A customer can only touch their own job, proven by the
//! random job token (header `X-Job-Token` or `?t=` for links/websockets).

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

use crate::auth::{random_token, sha256_hex};
use crate::error::{AppError, AppResult, bad};
use crate::events::Event;
use crate::models::{self, Job, JobDetail, PRINTER_COLS, PrintReq, Printer};
use crate::services::{convert, jobs_util, payment, storage};
use crate::settings::Settings;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/jobs", post(create_job))
        .route("/api/jobs/{id}", get(get_job))
        .route(
            "/api/jobs/{id}/files",
            post(upload).layer(DefaultBodyLimit::disable()),
        )
        .route("/api/jobs/{id}/files/{fid}", delete(delete_file))
        .route("/api/jobs/{id}/files/{fid}/pdf", get(file_pdf))
        .route("/api/jobs/{id}/submit", post(submit))
        .route("/api/printers/available", get(available_printers))
        .route("/api/jobs/{id}/quote", post(quote))
        .route("/api/jobs/{id}/pay", post(pay))
        .route("/api/jobs/{id}/self-print", post(self_print))
}

#[derive(Deserialize, Default)]
pub struct TokenQuery {
    pub t: Option<String>,
}

/// Loads the job if the caller holds its token.
pub async fn authorize(
    st: &AppState,
    id: i64,
    headers: &HeaderMap,
    q: &TokenQuery,
) -> AppResult<Job> {
    let token = headers
        .get("x-job-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| q.t.clone())
        .ok_or(AppError::NotFound)?;
    let row: Option<(String,)> = sqlx::query_as("SELECT token_hash FROM jobs WHERE id = ?")
        .bind(id)
        .fetch_optional(&st.db)
        .await?;
    // Same answer for "no such job" and "wrong token": don't reveal which jobs exist.
    match row {
        Some((hash,)) if hash == sha256_hex(&token) => Ok(sqlx::query_as(&format!(
            "SELECT {} FROM jobs WHERE id = ?",
            models::JOB_COLS
        ))
        .bind(id)
        .fetch_one(&st.db)
        .await?),
        _ => Err(AppError::NotFound),
    }
}

#[derive(Deserialize, Default)]
struct CreateJob {
    customer_name: Option<String>,
    customer_phone: Option<String>,
}

fn clean_opt(s: Option<String>, max: usize) -> Option<String> {
    s.map(|v| {
        v.trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(max)
            .collect::<String>()
    })
    .filter(|v| !v.is_empty())
}

async fn create_job(
    State(st): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<CreateJob>,
) -> AppResult<Json<Value>> {
    if !st
        .limiter
        .check(addr.ip(), "create_job", 30, Duration::from_secs(600))
    {
        return Err(bad("Too many requests. Please wait a few minutes."));
    }
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let token = random_token();
    // Retry in the (rare) case two customers grab the same daily number at once.
    for _ in 0..5 {
        let code = jobs_util::next_code(&st.db, &today).await?;
        let rel = storage::job_rel_dir(&today, &code);
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM jobs WHERE storage_dir = ?)")
                .bind(&rel)
                .fetch_one(&st.db)
                .await?;
        if exists {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO jobs(code, token_hash, customer_name, customer_phone, storage_dir) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&code)
        .bind(sha256_hex(&token))
        .bind(clean_opt(req.customer_name.clone(), 60))
        .bind(clean_opt(req.customer_phone.clone(), 20))
        .bind(&rel)
        .execute(&st.db)
        .await?;
        return Ok(Json(
            json!({ "id": res.last_insert_rowid(), "code": code, "token": token }),
        ));
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not allocate job code"
    )))
}

async fn get_job(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> AppResult<Json<JobDetail>> {
    authorize(&st, id, &headers, &q).await?;
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn upload(
    State(st): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    mut mp: Multipart,
) -> AppResult<Json<JobDetail>> {
    let job = authorize(&st, id, &headers, &q).await?;
    if job.status != "uploaded" {
        return Err(bad(
            "This job was already sent. Start a new one to add files.",
        ));
    }
    if !st
        .limiter
        .check(addr.ip(), "upload", 200, Duration::from_secs(600))
    {
        return Err(bad("Too many uploads. Please wait a few minutes."));
    }
    let settings = Settings::load(&st.db).await?;
    let max_bytes = settings.max_file_mb as u64 * 1024 * 1024;
    let storage_dir: String = sqlx::query_scalar("SELECT storage_dir FROM jobs WHERE id = ?")
        .bind(id)
        .fetch_one(&st.db)
        .await?;
    let dir = storage::original_dir(&st.config.data_dir, &storage_dir);
    tokio::fs::create_dir_all(&dir).await?;

    while let Some(mut field) = mp
        .next_field()
        .await
        .map_err(|e| bad(format!("Upload interrupted: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let display_name: String = field
            .file_name()
            .unwrap_or("file")
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("file")
            .chars()
            .take(200)
            .collect();
        let safe = storage::sanitize_filename(&display_name);
        let ext = storage::extension(&safe);
        if !convert::is_allowed(&ext) {
            return Err(bad(format!(
                "\"{display_name}\" can't be printed. Send PDF, photos, Word, Excel or PowerPoint files."
            )));
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM job_files WHERE job_id = ?")
            .bind(id)
            .fetch_one(&st.db)
            .await?;
        if count >= settings.max_files_per_job as i64 {
            return Err(bad(format!(
                "You can send up to {} files at once",
                settings.max_files_per_job
            )));
        }
        let stored = format!("{:02}_{safe}", count + 1);
        let final_path = dir.join(&stored);
        let part_path = dir.join(format!("{stored}.part"));
        let mut out = tokio::fs::File::create(&part_path).await?;
        let mut size: u64 = 0;
        let write_result: AppResult<()> = async {
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| bad(format!("Upload interrupted: {e}")))?
            {
                size += chunk.len() as u64;
                if size > max_bytes {
                    return Err(bad(format!(
                        "\"{display_name}\" is larger than {} MB",
                        settings.max_file_mb
                    )));
                }
                out.write_all(&chunk).await?;
            }
            out.flush().await?;
            Ok(())
        }
        .await;
        drop(out);
        if let Err(e) = write_result {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(e);
        }
        if size == 0 {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(bad(format!("\"{display_name}\" is empty")));
        }
        tokio::fs::rename(&part_path, &final_path).await?;
        let mime = mime_guess::from_ext(&ext)
            .first_or_octet_stream()
            .to_string();
        let rel = format!("{storage_dir}/original/{stored}");
        let res = sqlx::query(
            "INSERT INTO job_files(job_id, original_name, mime, size_bytes, original_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&display_name)
        .bind(mime)
        .bind(size as i64)
        .bind(rel)
        .execute(&st.db)
        .await?;
        let _ = st.convert_tx.send(res.last_insert_rowid());
    }
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn delete_file(
    State(st): State<AppState>,
    Path((id, fid)): Path<(i64, i64)>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> AppResult<Json<JobDetail>> {
    let job = authorize(&st, id, &headers, &q).await?;
    if job.status != "uploaded" {
        return Err(bad("This job was already sent"));
    }
    let paths: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT original_path, pdf_path FROM job_files WHERE id = ? AND job_id = ?")
            .bind(fid)
            .bind(id)
            .fetch_optional(&st.db)
            .await?;
    let (orig, pdf) = paths.ok_or(AppError::NotFound)?;
    sqlx::query("DELETE FROM job_files WHERE id = ?")
        .bind(fid)
        .execute(&st.db)
        .await?;
    let root = storage::storage_root(&st.config.data_dir);
    let _ = tokio::fs::remove_file(root.join(orig)).await;
    if let Some(p) = pdf {
        let _ = tokio::fs::remove_file(root.join(p)).await;
    }
    jobs_util::recompute_pages(&st.db, id).await?;
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn file_pdf(
    State(st): State<AppState>,
    Path((id, fid)): Path<(i64, i64)>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> AppResult<Response> {
    authorize(&st, id, &headers, &q).await?;
    let pdf: Option<String> =
        sqlx::query_scalar("SELECT pdf_path FROM job_files WHERE id = ? AND job_id = ?")
            .bind(fid)
            .bind(id)
            .fetch_optional(&st.db)
            .await?
            .flatten();
    let pdf = pdf.ok_or(AppError::NotFound)?;
    super::files::send_file(
        &storage::storage_root(&st.config.data_dir).join(pdf),
        "application/pdf",
        None,
    )
    .await
}

#[derive(Deserialize, Default)]
struct SubmitReq {
    notes: Option<String>,
}

async fn submit(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Json(req): Json<SubmitReq>,
) -> AppResult<Json<JobDetail>> {
    let job = authorize(&st, id, &headers, &q).await?;
    if job.status != "uploaded" {
        return Err(bad("This job was already sent"));
    }
    ensure_has_files(&st, id).await?;
    sqlx::query("UPDATE jobs SET mode = 'submit', status = 'submitted', notes = ?, updated_at = ? WHERE id = ?")
        .bind(clean_opt(req.notes, 500))
        .bind(crate::db::now())
        .bind(id)
        .execute(&st.db)
        .await?;
    st.emit(Event::JobUpdated {
        job_id: id,
        status: "submitted".into(),
        new: true,
    });
    Ok(Json(models::job_detail(&st.db, id).await?))
}

async fn ensure_has_files(st: &AppState, id: i64) -> AppResult<()> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM job_files WHERE job_id = ?")
        .bind(id)
        .fetch_one(&st.db)
        .await?;
    if n == 0 {
        return Err(bad("Add at least one file first"));
    }
    Ok(())
}

async fn available_printers(State(st): State<AppState>) -> AppResult<Json<Vec<Value>>> {
    let printers: Vec<Printer> = sqlx::query_as(&format!(
        "SELECT {PRINTER_COLS} FROM printers WHERE is_active = 1 AND allow_self_print = 1 ORDER BY display_name"
    ))
    .fetch_all(&st.db)
    .await?;
    // Customers don't need the Windows printer name.
    Ok(Json(
        printers
            .into_iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "display_name": p.display_name,
                    "supports_color": p.supports_color,
                    "supports_duplex": p.supports_duplex,
                    "paper_sizes": p.papers(),
                })
            })
            .collect(),
    ))
}

async fn quote(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Json(req): Json<PrintReq>,
) -> AppResult<Json<models::PrintPlan>> {
    authorize(&st, id, &headers, &q).await?;
    Ok(Json(models::plan_print(&st.db, id, &req, true).await?))
}

/// Payment is disabled: always reports "skipped".
async fn pay(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> AppResult<Json<Value>> {
    let job = authorize(&st, id, &headers, &q).await?;
    let outcome = payment::provider().charge(id, job.estimated_price);
    Ok(Json(
        json!({ "status": outcome, "provider": payment::provider().name() }),
    ))
}

async fn self_print(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Json(req): Json<PrintReq>,
) -> AppResult<Json<JobDetail>> {
    let job = authorize(&st, id, &headers, &q).await?;
    if job.status != "uploaded" {
        return Err(bad("This job was already sent"));
    }
    let plan = models::plan_print(&st.db, id, &req, true).await?;
    let outcome = payment::provider().charge(id, plan.total_price);
    if outcome == payment::PaymentOutcome::Pending {
        return Err(bad("Payment not completed"));
    }
    sqlx::query(
        "UPDATE jobs SET mode = 'self', estimated_price = ?, payment_status = ?, updated_at = ? WHERE id = ?",
    )
    .bind(plan.total_price)
    .bind(outcome.as_db())
    .bind(crate::db::now())
    .bind(id)
    .execute(&st.db)
    .await?;
    models::enqueue_plan(&st, id, &plan, "customer").await?;
    st.emit(Event::JobUpdated {
        job_id: id,
        status: "queued".into(),
        new: true,
    });
    Ok(Json(models::job_detail(&st.db, id).await?))
}
