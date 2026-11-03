// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod updater;

use std::sync::Arc;
use std::time::Duration;

use scantoprint_core::update::UpdateBridge;
use scantoprint_core::{config::Config, server};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub const MAIN_WINDOW: &str = "main";
/// Passed by the autostart entry so the app starts quietly in the tray at boot.
const MINIMIZED_ARG: &str = "--minimized";

fn main() {
    let mut config = Config::from_env();
    let _log_guard = init_logging(&config.data_dir);
    let bridge = Arc::new(UpdateBridge::new(true));
    config.updates = bridge.clone();
    let port = config.bind.port();
    let start_minimized = std::env::args().any(|a| a == MINIMIZED_ARG);

    tauri::Builder::default()
        // A second launch (e.g. double-clicking the shortcut) just shows the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_dashboard(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_ARG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppPort(port))
        .setup(move |app| {
            let data_dir = config.data_dir.clone();

            // Run the web server for the life of the app.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::run(config, std::future::pending()).await {
                    tracing::error!("server stopped: {e:#}");
                    tray::set_error(&handle, &format!("{e:#}"));
                }
            });

            enable_autostart_on_first_run(app.handle(), &data_dir);
            tray::create(app.handle())?;
            updater::start(app.handle().clone(), bridge.clone());

            if !start_minimized {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    wait_for_server(port).await;
                    show_dashboard(&handle);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the server running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building ScanToPrint")
        .run(|_app, event| {
            // No windows open must not quit the app; only the tray "Quit" does (exit code set).
            if let RunEvent::ExitRequested { api, code, .. } = event
                && code.is_none()
            {
                api.prevent_exit();
            }
        });
}

pub struct AppPort(pub u16);

pub fn dashboard_url(app: &AppHandle, path: &str) -> String {
    let port = app.state::<AppPort>().0;
    format!("http://127.0.0.1:{port}{path}")
}

/// Show (or create) the dashboard window.
pub fn show_dashboard(app: &AppHandle) {
    open_path(app, "/admin");
}

pub fn open_path(app: &AppHandle, path: &str) {
    let url = dashboard_url(app, path);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        if let Ok(parsed) = url.parse() {
            let _ = win.navigate(parsed);
        }
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let Ok(parsed) = url.parse() else { return };
    if let Err(e) = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(parsed))
        .title("ScanToPrint")
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .build()
    {
        tracing::error!("could not open dashboard window: {e}");
    }
}

async fn wait_for_server(port: u16) {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tracing::warn!("server did not start within 10s on port {port}");
}

/// "Start with Windows" is on by default, but only set once so the owner can turn it off.
fn enable_autostart_on_first_run(app: &AppHandle, data_dir: &std::path::Path) {
    let marker = data_dir.join(".autostart-initialized");
    if marker.exists() {
        return;
    }
    if cfg!(debug_assertions) {
        return; // never register dev builds
    }
    match app.autolaunch().enable() {
        Ok(()) => {
            let _ = std::fs::create_dir_all(data_dir);
            let _ = std::fs::write(&marker, b"1");
        }
        Err(e) => tracing::warn!("could not enable autostart: {e}"),
    }
}

/// Log to `<data>/logs/scantoprint.log.YYYY-MM-DD` (and stdout in dev).
fn init_logging(data_dir: &std::path::Path) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::prelude::*;
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,scantoprint_core=info".into());
    let logs = data_dir.join("logs");
    let file = std::fs::create_dir_all(&logs).ok().map(|_| {
        let appender = tracing_appender::rolling::Builder::new()
            .rotation(tracing_appender::rolling::Rotation::DAILY)
            .filename_prefix("scantoprint")
            .filename_suffix("log")
            .max_log_files(14)
            .build(&logs);
        appender.ok().map(tracing_appender::non_blocking)
    });
    let (file_layer, guard) = match file.flatten() {
        Some((writer, guard)) => (
            Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(writer),
            ),
            Some(guard),
        ),
        None => (None, None),
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(file_layer)
        .init();
    guard
}
