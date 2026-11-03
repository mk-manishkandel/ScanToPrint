use anyhow::Context;
use tokio::net::TcpListener;

use crate::config::Config;

/// Start the HTTP server and run until `shutdown` resolves.
pub async fn run(
    config: Config,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&config.data_dir)
        .with_context(|| format!("creating data dir {}", config.data_dir.display()))?;

    let app = crate::http::router();
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("binding {}", config.bind))?;
    tracing::info!(
        "ScanToPrint {} listening on http://{}",
        crate::VERSION,
        config.bind
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .context("http server")?;
    Ok(())
}
