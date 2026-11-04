use chrono::Datelike;
use sqlx::SqlitePool;

use crate::error::AppResult;

/// Short code customers say at the counter, e.g. `K-042`.
/// The letter changes daily so codes from different days don't clash; the number resets daily.
/// `attempt` skips ahead when a concurrent request already took the next number.
pub async fn next_code(db: &SqlitePool, today: &str, attempt: i64) -> AppResult<String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE storage_dir LIKE ?")
        .bind(format!("{today}/%"))
        .fetch_one(db)
        .await?;
    let days = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map(|d| d.num_days_from_ce())
        .unwrap_or(0);
    let letter = (b'A' + (days.rem_euclid(26)) as u8) as char;
    Ok(format!("{letter}-{:03}", count + 1 + attempt))
}

pub async fn recompute_pages(db: &SqlitePool, job_id: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE jobs SET total_pages = (SELECT COALESCE(SUM(page_count), 0) FROM job_files WHERE job_id = ?),
                         updated_at = ? WHERE id = ?",
    )
    .bind(job_id)
    .bind(crate::db::now())
    .bind(job_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_status(db: &SqlitePool, job_id: i64, status: &str) -> AppResult<()> {
    sqlx::query("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(crate::db::now())
        .bind(job_id)
        .execute(db)
        .await?;
    Ok(())
}
