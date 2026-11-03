use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use anyhow::Context;
use sqlx::SqlitePool;
use sqlx::migrate::Migrator;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

/// Migrations are compiled into the binary. Forward-only: never edit a released file.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub const DB_FILE: &str = "scantoprint.db";

/// Open (or create) the database, back it up if migrations are pending, then migrate.
pub async fn open(data_dir: &Path) -> anyhow::Result<SqlitePool> {
    let path = data_dir.join(DB_FILE);
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await
        .with_context(|| format!("opening database {}", path.display()))?;

    backup_if_migrations_pending(&pool, data_dir).await?;
    MIGRATOR
        .run(&pool)
        .await
        .context("running database migrations")?;
    Ok(pool)
}

/// In-memory database for tests.
pub async fn open_memory() -> anyhow::Result<SqlitePool> {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?.foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

/// Before an app update changes the schema, keep a copy of the old database.
async fn backup_if_migrations_pending(pool: &SqlitePool, data_dir: &Path) -> anyhow::Result<()> {
    let has_table: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if !has_table {
        return Ok(()); // brand-new database, nothing to back up
    }
    let applied: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(pool)
            .await?;
    let known = MIGRATOR
        .iter()
        .filter(|m| m.migration_type.is_up_migration())
        .count() as i64;
    if applied >= known {
        return Ok(());
    }
    let dir = data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!(
        "scantoprint-{}-before-v{}.db",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        crate::VERSION
    ));
    sqlx::query("VACUUM INTO ?")
        .bind(file.to_string_lossy().to_string())
        .execute(pool)
        .await
        .context("backing up database before migration")?;
    tracing::info!("database backed up to {}", file.display());
    Ok(())
}

pub fn now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%.3fZ")
        .to_string()
}
