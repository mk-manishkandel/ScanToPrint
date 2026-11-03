//! ScanToPrint core: everything that runs on the shop PC except the desktop shell.
//!
//! The Tauri app (`src-tauri`) and the `dev-server` binary both call [`server::run`].

pub mod config;
pub mod http;
pub mod server;

/// App version, shown in the dashboard and used by the updater.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
