pub mod cleanup;
pub mod convert;
pub mod jobs_util;
pub mod msoffice;
pub mod network;
pub mod pages;
pub mod payment;
pub mod pdf;
pub mod print;
pub mod printers;
pub mod storage;

/// Don't flash a console window when the GUI app runs helper programs on Windows.
pub fn hide_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
