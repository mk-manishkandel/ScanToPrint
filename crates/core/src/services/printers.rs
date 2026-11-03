//! Discover printers installed in the operating system.

/// Name of the fake printer available on non-Windows machines (development).
pub const MOCK_PRINTER: &str = "Mock Printer (development)";

pub async fn list_system_printers() -> anyhow::Result<Vec<String>> {
    #[cfg(windows)]
    {
        let mut cmd = tokio::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name",
        ]);
        crate::services::hide_window(&mut cmd);
        let out = cmd.output().await?;
        if !out.status.success() {
            anyhow::bail!(
                "Get-Printer failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(parse_lines(&String::from_utf8_lossy(&out.stdout)))
    }
    #[cfg(not(windows))]
    {
        let mut names = vec![MOCK_PRINTER.to_string()];
        if let Ok(out) = tokio::process::Command::new("lpstat")
            .arg("-e")
            .output()
            .await
            && out.status.success()
        {
            names.extend(parse_lines(&String::from_utf8_lossy(&out.stdout)));
        }
        Ok(names)
    }
}

fn parse_lines(s: &str) -> Vec<String> {
    let mut v: Vec<String> = s
        .lines()
        .map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
        .filter(|l| !l.is_empty())
        .collect();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        assert_eq!(
            super::parse_lines("\u{feff}HP LaserJet\r\n\r\nMicrosoft Print to PDF\r\n"),
            vec!["HP LaserJet", "Microsoft Print to PDF"]
        );
    }
}
