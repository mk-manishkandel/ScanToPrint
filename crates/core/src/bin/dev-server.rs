//! Runs the ScanToPrint server without the desktop shell (development on any OS).

use scantoprint_core::{config::Config, server};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,scantoprint_core=debug".into()),
        )
        .init();

    let config = Config::from_env();
    server::run(config, async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}
