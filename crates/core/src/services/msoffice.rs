//! Convert Word, Excel and PowerPoint files to PDF with the copy of Microsoft Office
//! installed on the shop PC (Windows only). Office's own "Save as PDF" gives the most
//! faithful output, so it is tried first; LibreOffice is the fallback.
//!
//! Office is driven through COM from a short PowerShell script:
//! - files open read-only, macros are force-disabled, alerts are off;
//! - a dummy password makes protected files fail fast instead of showing a prompt;
//! - Office is only closed if we were the only user, so an open Word window the
//!   shop owner is typing in is never closed.

use std::path::Path;

use crate::services::convert::{EXCEL_EXT, POWERPOINT_EXT, WORD_EXT};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum App {
    Word,
    Excel,
    PowerPoint,
}

impl App {
    /// The Office app that opens this extension, if any.
    pub fn for_ext(ext: &str) -> Option<App> {
        // Apple formats only open in LibreOffice (and not always there).
        if matches!(ext, "pages" | "numbers" | "key" | "wpd") {
            None
        } else if WORD_EXT.contains(&ext) {
            Some(App::Word)
        } else if EXCEL_EXT.contains(&ext) {
            Some(App::Excel)
        } else if POWERPOINT_EXT.contains(&ext) {
            Some(App::PowerPoint)
        } else {
            None
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            App::Word => "Word",
            App::Excel => "Excel",
            App::PowerPoint => "PowerPoint",
        }
    }

    fn prog_id(self) -> &'static str {
        match self {
            App::Word => "Word.Application",
            App::Excel => "Excel.Application",
            App::PowerPoint => "PowerPoint.Application",
        }
    }

    fn script(self) -> &'static str {
        match self {
            App::Word => WORD_PS,
            App::Excel => EXCEL_PS,
            App::PowerPoint => POWERPOINT_PS,
        }
    }
}

/// Which Office apps are installed (checked in the registry; cheap).
pub fn installed() -> Vec<App> {
    [App::Word, App::Excel, App::PowerPoint]
        .into_iter()
        .filter(|a| is_installed(*a))
        .collect()
}

pub fn is_installed(app: App) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("reg")
            .args(["query", &format!(r"HKCR\{}\CLSID", app.prog_id()), "/ve"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(not(windows))]
    {
        let _ = app.prog_id();
        false
    }
}

/// Convert `src` to `dest` (PDF) with the given Office app.
pub async fn to_pdf(
    app: App,
    src: &Path,
    dest: &Path,
    work_dir: &Path,
    timeout: std::time::Duration,
) -> anyhow::Result<()> {
    use anyhow::Context;
    // Office needs absolute paths.
    let src = std::path::absolute(src)?;
    let dest = std::path::absolute(dest)?;
    let script = work_dir.join("convert.ps1");
    std::fs::write(&script, app.script())?;

    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ])
    .arg(&script)
    .env("STP_SRC", &src)
    .env("STP_DEST", &dest)
    .kill_on_drop(true)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::piped());
    crate::services::hide_window(&mut cmd);
    let child = cmd
        .spawn()
        .with_context(|| format!("starting {}", app.name()))?;
    let out = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .with_context(|| format!("{} timed out", app.name()))??;
    if out.status.success() && dest.exists() {
        Ok(())
    } else {
        anyhow::bail!(
            "{} could not convert the file (exit {:?}): {}",
            app.name(),
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        )
    }
}

const WORD_PS: &str = r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Word.Application
try {
  $app.Visible = $false
  $app.DisplayAlerts = 0            # wdAlertsNone
  $app.AutomationSecurity = 3       # msoAutomationSecurityForceDisable
  # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument
  $doc = $app.Documents.Open($env:STP_SRC, $false, $true, $false, 'stp-no-password')
  try { $doc.ExportAsFixedFormat($env:STP_DEST, 17) }   # wdExportFormatPDF
  finally { $doc.Close(0) }                           # wdDoNotSaveChanges
} finally {
  if ($app.Documents.Count -eq 0) { $app.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
"#;

const EXCEL_PS: &str = r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Excel.Application
try {
  $app.Visible = $false
  $app.DisplayAlerts = $false
  $app.AskToUpdateLinks = $false
  $app.AutomationSecurity = 3       # msoAutomationSecurityForceDisable
  $m = [Type]::Missing
  # Filename, UpdateLinks, ReadOnly, Format, Password
  $wb = $app.Workbooks.Open($env:STP_SRC, 0, $true, $m, 'stp-no-password')
  try { $wb.ExportAsFixedFormat(0, $env:STP_DEST) }    # xlTypePDF
  finally { $wb.Close($false) }
} finally {
  if ($app.Workbooks.Count -eq 0) { $app.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
"#;

const POWERPOINT_PS: &str = r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $app.DisplayAlerts = 1            # ppAlertsNone
  $app.AutomationSecurity = 3       # msoAutomationSecurityForceDisable
  # "file::password::" makes a protected file fail instead of asking for a password.
  # FileName, ReadOnly (msoTrue), Untitled (msoFalse), WithWindow (msoFalse)
  $p = $app.Presentations.Open($env:STP_SRC + '::stp-no-password::', -1, 0, 0)
  try { $p.SaveAs($env:STP_DEST, 32) }                 # ppSaveAsPDF
  finally { $p.Close() }
} finally {
  # PowerPoint is single-instance: only quit if nobody else has a file open.
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_right_app() {
        assert_eq!(App::for_ext("docx"), Some(App::Word));
        assert_eq!(App::for_ext("rtf"), Some(App::Word));
        assert_eq!(App::for_ext("csv"), Some(App::Excel));
        assert_eq!(App::for_ext("pptx"), Some(App::PowerPoint));
        assert_eq!(App::for_ext("pages"), None);
        assert_eq!(App::for_ext("pdf"), None);
    }

    #[test]
    fn scripts_are_safe_by_default() {
        for app in [App::Word, App::Excel, App::PowerPoint] {
            let s = app.script();
            assert!(
                s.contains("AutomationSecurity = 3"),
                "{app:?} must disable macros"
            );
            assert!(
                s.contains("$env:STP_SRC"),
                "{app:?} must take the path from env"
            );
            assert!(
                s.contains(".Count -eq 0"),
                "{app:?} must not close the user's files"
            );
        }
    }
}
