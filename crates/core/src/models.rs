use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, bad};
use crate::services::pages::{self, Quote};
use crate::services::print::PAPER_SIZES;
use crate::settings::Settings;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Job {
    pub id: i64,
    pub code: String,
    pub customer_name: Option<String>,
    pub customer_phone: Option<String>,
    pub mode: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub total_pages: i64,
    pub estimated_price: f64,
    pub payment_status: String,
    pub created_at: String,
    pub updated_at: String,
}

pub const JOB_COLS: &str = "id, code, customer_name, customer_phone, mode, status, notes, total_pages, \
     estimated_price, payment_status, created_at, updated_at";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct JobFile {
    pub id: i64,
    pub original_name: String,
    pub mime: String,
    pub size_bytes: i64,
    pub page_count: Option<i64>,
    pub conversion_status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PrintRun {
    pub id: i64,
    pub file_id: i64,
    pub printer_id: Option<i64>,
    pub printer_name: Option<String>,
    pub page_range: Option<String>,
    pub copies: i64,
    pub color: bool,
    pub duplex: bool,
    pub paper_size: String,
    pub sheets: i64,
    pub triggered_by: String,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobDetail {
    #[serde(flatten)]
    pub job: Job,
    pub files: Vec<JobFile>,
    pub runs: Vec<PrintRun>,
}

pub async fn job_detail(db: &SqlitePool, id: i64) -> AppResult<JobDetail> {
    let job: Job = sqlx::query_as(&format!("SELECT {JOB_COLS} FROM jobs WHERE id = ?"))
        .bind(id)
        .fetch_one(db)
        .await?;
    let files = sqlx::query_as(
        "SELECT id, original_name, mime, size_bytes, page_count, conversion_status, error
         FROM job_files WHERE job_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    let runs = sqlx::query_as(
        "SELECT r.id, r.file_id, r.printer_id, p.display_name AS printer_name, r.page_range, r.copies,
                r.color, r.duplex, r.paper_size, r.sheets, r.triggered_by, r.status, r.error, r.created_at
         FROM print_runs r LEFT JOIN printers p ON p.id = r.printer_id
         WHERE r.job_id = ? ORDER BY r.id",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    Ok(JobDetail { job, files, runs })
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Printer {
    pub id: i64,
    pub system_name: String,
    pub display_name: String,
    pub is_active: bool,
    pub allow_self_print: bool,
    pub supports_color: bool,
    pub supports_duplex: bool,
    pub paper_sizes: String,
}

impl Printer {
    pub fn papers(&self) -> Vec<String> {
        serde_json::from_str(&self.paper_sizes).unwrap_or_else(|_| vec!["A4".into()])
    }
}

pub const PRINTER_COLS: &str = "id, system_name, display_name, is_active, allow_self_print, supports_color, supports_duplex, paper_sizes";

// ---------- print planning (shared by customer self-print and staff print) ----------

#[derive(Debug, Clone, Deserialize)]
pub struct PrintReq {
    pub printer_id: i64,
    pub items: Vec<PrintItem>,
}

fn one() -> u32 {
    1
}
fn a4() -> String {
    "A4".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrintItem {
    pub file_id: i64,
    #[serde(default)]
    pub page_range: String,
    #[serde(default = "one")]
    pub copies: u32,
    #[serde(default)]
    pub color: bool,
    #[serde(default)]
    pub duplex: bool,
    #[serde(default = "a4")]
    pub paper_size: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlannedItem {
    pub file_id: i64,
    pub file_name: String,
    #[serde(skip)]
    pub sumatra_range: Option<String>,
    pub pages: u32,
    pub copies: u32,
    pub color: bool,
    pub duplex: bool,
    pub paper_size: String,
    pub quote: Quote,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrintPlan {
    pub printer_id: i64,
    pub items: Vec<PlannedItem>,
    pub total_sheets: u32,
    pub total_price: f64,
    pub currency: String,
}

/// Validates a print request against the job, the printer and the shop's prices.
pub async fn plan_print(
    db: &SqlitePool,
    job_id: i64,
    req: &PrintReq,
    by_customer: bool,
) -> AppResult<PrintPlan> {
    if req.items.is_empty() {
        return Err(bad("Choose at least one file to print"));
    }
    if req.items.len() > 100 {
        return Err(bad("Too many files"));
    }
    let printer: Printer =
        sqlx::query_as(&format!("SELECT {PRINTER_COLS} FROM printers WHERE id = ?"))
            .bind(req.printer_id)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| bad("Printer not found"))?;
    if !printer.is_active || (by_customer && !printer.allow_self_print) {
        return Err(bad("That printer isn't available right now"));
    }
    let settings = Settings::load(db).await?;
    let papers = printer.papers();
    let mut items = Vec::new();
    for it in &req.items {
        if !(1..=100).contains(&it.copies) {
            return Err(bad("Copies must be between 1 and 100"));
        }
        if !PAPER_SIZES.contains(&it.paper_size.as_str()) || !papers.contains(&it.paper_size) {
            return Err(bad(format!(
                "{} paper isn't available on this printer",
                it.paper_size
            )));
        }
        if it.color && !printer.supports_color {
            return Err(bad("This printer prints black & white only"));
        }
        if it.duplex && !printer.supports_duplex {
            return Err(bad("This printer can't print double-sided"));
        }
        let row: Option<(String, String, Option<i64>)> = sqlx::query_as(
            "SELECT original_name, conversion_status, page_count FROM job_files WHERE id = ? AND job_id = ?",
        )
        .bind(it.file_id)
        .bind(job_id)
        .fetch_optional(db)
        .await?;
        let (name, conv, pages) = row.ok_or(AppError::NotFound)?;
        let total = match (conv.as_str(), pages) {
            ("ok", Some(p)) if p > 0 => p as u32,
            ("pending", _) => {
                return Err(bad(format!(
                    "\"{name}\" is still being prepared — try again in a moment"
                )));
            }
            _ => return Err(bad(format!("\"{name}\" can't be printed automatically"))),
        };
        let selected =
            pages::parse_range(&it.page_range, total).map_err(|e| bad(format!("{name}: {e}")))?;
        let n = selected.len() as u32;
        items.push(PlannedItem {
            file_id: it.file_id,
            file_name: name,
            sumatra_range: pages::sumatra_range(&selected, total),
            pages: n,
            copies: it.copies,
            color: it.color,
            duplex: it.duplex,
            paper_size: it.paper_size.clone(),
            quote: pages::quote(n, it.copies, it.color, it.duplex, &settings),
        });
    }
    let total_sheets = items.iter().map(|i| i.quote.sheets).sum();
    let total_price = (items.iter().map(|i| i.quote.price).sum::<f64>() * 100.0).round() / 100.0;
    Ok(PrintPlan {
        printer_id: printer.id,
        items,
        total_sheets,
        total_price,
        currency: settings.currency,
    })
}

/// Inserts print runs for a plan and queues them. Returns run ids.
pub async fn enqueue_plan(
    st: &crate::state::AppState,
    job_id: i64,
    plan: &PrintPlan,
    triggered_by: &str,
) -> AppResult<Vec<i64>> {
    let mut tx = st.db.begin().await?;
    let mut ids = Vec::new();
    for it in &plan.items {
        let r = sqlx::query(
            "INSERT INTO print_runs(job_id, file_id, printer_id, page_range, copies, color, duplex,
                                    paper_size, sheets, triggered_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(job_id)
        .bind(it.file_id)
        .bind(plan.printer_id)
        .bind(&it.sumatra_range)
        .bind(it.copies as i64)
        .bind(it.color)
        .bind(it.duplex)
        .bind(&it.paper_size)
        .bind(it.quote.sheets as i64)
        .bind(triggered_by)
        .execute(&mut *tx)
        .await?;
        ids.push(r.last_insert_rowid());
    }
    sqlx::query("UPDATE jobs SET status = 'queued', updated_at = ? WHERE id = ?")
        .bind(crate::db::now())
        .bind(job_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    for id in &ids {
        let _ = st.print_tx.send(*id);
    }
    Ok(ids)
}
