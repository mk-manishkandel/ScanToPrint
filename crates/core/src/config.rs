use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

/// Default port. Printed QR posters encode this, so it must never change silently.
pub const DEFAULT_PORT: u16 = 8080;

#[derive(Debug, Clone)]
pub struct Config {
    /// Root data folder (database, uploaded files, logs).
    pub data_dir: PathBuf,
    /// Address the HTTP server listens on (all interfaces so phones on the Wi-Fi can reach it).
    pub bind: SocketAddr,
}

impl Config {
    pub fn new(data_dir: PathBuf, port: u16) -> Self {
        Self {
            data_dir,
            bind: SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port),
        }
    }

    /// `%ProgramData%\ScanToPrint` on Windows; `./data` elsewhere (development).
    pub fn default_data_dir() -> PathBuf {
        #[cfg(windows)]
        {
            let base = std::env::var_os("ProgramData")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
            base.join("ScanToPrint")
        }
        #[cfg(not(windows))]
        {
            PathBuf::from("data")
        }
    }

    pub fn from_env() -> Self {
        let data_dir = std::env::var_os("SCANTOPRINT_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(Self::default_data_dir);
        let port = std::env::var("SCANTOPRINT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_PORT);
        Self::new(data_dir, port)
    }
}
