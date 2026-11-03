//! ScanToPrint core: everything that runs on the shop PC except the desktop shell.
//!
//! The Tauri app (`src-tauri`) and the `dev-server` binary both call [`server::run`].

pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod events;
pub mod http;
pub mod models;
pub mod server;
pub mod services;
pub mod settings;
pub mod state;
pub mod update;

/// App version, shown in the dashboard and used by the updater.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
