use anyhow::Context;
use tokio::net::TcpListener;

use crate::config::Config;
use crate::state::AppState;

/// Open the database, start background workers and run the HTTP server until `shutdown`.
pub async fn run(
    config: Config,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&config.data_dir)
        .with_context(|| format!("creating data dir {}", config.data_dir.display()))?;

    let db = crate::db::open(&config.data_dir).await?;
    let bind = config.bind;
    let (state, workers) = AppState::new(db, config);
    workers.start(&state);
    crate::services::cleanup::start(state.clone());

    let app = crate::http::router(state);
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("port {} is already in use", bind.port()))?;
    tracing::info!("ScanToPrint {} listening on http://{bind}", crate::VERSION);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .context("http server")?;
    Ok(())
}
