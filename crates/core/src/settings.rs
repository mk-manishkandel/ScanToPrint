use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{AppResult, bad};

/// Shop-wide settings, stored as key/value rows so new settings never need a migration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub shop_name: String,
    pub retention_days: u32,
    pub max_file_mb: u32,
    pub max_files_per_job: u32,
    pub currency: String,
    pub price_bw_single: f64,
    pub price_bw_duplex: f64,
    pub price_color_single: f64,
    pub price_color_duplex: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shop_name: "Print Shop".into(),
            retention_days: 7,
            max_file_mb: 50,
            max_files_per_job: 20,
            currency: "Rs.".into(),
            price_bw_single: 2.0,
            price_bw_duplex: 3.0,
            price_color_single: 10.0,
            price_color_duplex: 18.0,
        }
    }
}

impl Settings {
    pub async fn load(db: &SqlitePool) -> AppResult<Self> {
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
            .fetch_all(db)
            .await?;
        let mut map = serde_json::Map::new();
        for (k, v) in rows {
            map.insert(
                k,
                serde_json::from_str(&v).unwrap_or(serde_json::Value::String(v)),
            );
        }
        // Unknown/missing keys fall back to defaults (serde(default)).
        Ok(serde_json::from_value(serde_json::Value::Object(map)).unwrap_or_default())
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.shop_name.trim().is_empty() || self.shop_name.len() > 80 {
            return Err(bad("Shop name must be 1–80 characters"));
        }
        if !(1..=365).contains(&self.retention_days) {
            return Err(bad("Keep files for 1–365 days"));
        }
        if !(1..=500).contains(&self.max_file_mb) {
            return Err(bad("Max file size must be 1–500 MB"));
        }
        if !(1..=100).contains(&self.max_files_per_job) {
            return Err(bad("Max files per job must be 1–100"));
        }
        let prices = [
            self.price_bw_single,
            self.price_bw_duplex,
            self.price_color_single,
            self.price_color_duplex,
        ];
        if prices.iter().any(|p| !p.is_finite() || *p < 0.0) {
            return Err(bad("Prices must be zero or more"));
        }
        Ok(())
    }

    pub async fn save(&self, db: &SqlitePool) -> AppResult<()> {
        self.validate()?;
        let value = serde_json::to_value(self).map_err(anyhow::Error::from)?;
        let mut tx = db.begin().await?;
        if let serde_json::Value::Object(map) = value {
            for (k, v) in map {
                sqlx::query(
                    "INSERT INTO settings(key, value) VALUES (?, ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(k)
                .bind(v.to_string())
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_then_roundtrip() {
        let db = crate::db::open_memory().await.unwrap();
        assert_eq!(Settings::load(&db).await.unwrap(), Settings::default());
        let s = Settings {
            shop_name: "Kandel Stationery".into(),
            price_bw_single: 2.5,
            ..Default::default()
        };
        s.save(&db).await.unwrap();
        assert_eq!(Settings::load(&db).await.unwrap(), s);
    }

    #[test]
    fn rejects_negative_price() {
        let s = Settings {
            price_color_single: -1.0,
            ..Default::default()
        };
        assert!(s.validate().is_err());
    }
}
