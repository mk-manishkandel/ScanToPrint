//! Payment step. Disabled for now: every charge is "skipped".
//! To add eSewa / Khalti / FonePay later, implement `PaymentProvider` and select it in `provider()`.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentOutcome {
    Skipped,
    Paid,
    Pending,
}

impl PaymentOutcome {
    pub fn as_db(self) -> &'static str {
        match self {
            PaymentOutcome::Skipped => "skipped",
            PaymentOutcome::Paid => "paid",
            PaymentOutcome::Pending => "pending",
        }
    }
}

pub trait PaymentProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn charge(&self, job_id: i64, amount: f64) -> PaymentOutcome;
}

pub struct NoopProvider;

impl PaymentProvider for NoopProvider {
    fn name(&self) -> &'static str {
        "none"
    }
    fn charge(&self, _job_id: i64, _amount: f64) -> PaymentOutcome {
        PaymentOutcome::Skipped
    }
}

pub fn provider() -> &'static dyn PaymentProvider {
    &NoopProvider
}
