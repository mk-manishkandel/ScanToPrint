//! Discover printers installed in the operating system.

/// Name of the fake printer available on non-Windows machines (development).
pub const MOCK_PRINTER: &str = "Mock Printer (development)";

/// A printer installed in the OS, with what Windows reports it can do.
#[derive(Debug, Clone, PartialEq)]
pub struct SystemPrinter {
    pub name: String,
    pub color: bool,
    pub duplex: bool,
}

pub async fn list_system_printers() -> anyhow::Result<Vec<SystemPrinter>> {
    #[cfg(windows)]
    {
        // Win32_Printer.CapabilityDescriptions lists e.g. "Copies", "Color", "Duplex".
        let script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
            Get-CimInstance -ClassName Win32_Printer | ForEach-Object { \
              $c = @($_.CapabilityDescriptions); \
              \"$($_.Name)`t$($c -contains 'Color')`t$($c -contains 'Duplex')\" }";
        let mut cmd = tokio::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        crate::services::hide_window(&mut cmd);
        let out = cmd.output().await?;
        if out.status.success() {
            let list = parse_capabilities(&String::from_utf8_lossy(&out.stdout));
            if !list.is_empty() {
                return Ok(list);
            }
        }
        // Fallback: names only (capabilities set by hand on the Printers page).
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
        Ok(names_only(parse_lines(&String::from_utf8_lossy(
            &out.stdout,
        ))))
    }
    #[cfg(not(windows))]
    {
        let mut list = vec![SystemPrinter {
            name: MOCK_PRINTER.to_string(),
            color: true,
            duplex: true,
        }];
        if let Ok(out) = tokio::process::Command::new("lpstat")
            .arg("-e")
            .output()
            .await
            && out.status.success()
        {
            list.extend(names_only(parse_lines(&String::from_utf8_lossy(
                &out.stdout,
            ))));
        }
        Ok(list)
    }
}

fn names_only(names: Vec<String>) -> Vec<SystemPrinter> {
    names
        .into_iter()
        .map(|name| SystemPrinter {
            name,
            color: false,
            duplex: false,
        })
        .collect()
}

/// Parses `Name<TAB>True<TAB>False` lines from the PowerShell capability query.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_capabilities(s: &str) -> Vec<SystemPrinter> {
    let mut out: Vec<SystemPrinter> = Vec::new();
    for line in parse_lines(s) {
        let mut parts = line.rsplitn(3, '\t');
        let (Some(duplex), Some(color), Some(name)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || out.iter().any(|p| p.name == name) {
            continue;
        }
        out.push(SystemPrinter {
            name: name.to_string(),
            color: color.trim().eq_ignore_ascii_case("true"),
            duplex: duplex.trim().eq_ignore_ascii_case("true"),
        });
    }
    out
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

    #[test]
    fn parses_capabilities() {
        let got = super::parse_capabilities(
            "\u{feff}EPSON L805\tTrue\tFalse\r\nBrother DCP\tFalse\tTrue\r\nbad line\r\n",
        );
        assert_eq!(got.len(), 2);
        assert_eq!(
            (got[0].name.as_str(), got[0].color, got[0].duplex),
            ("EPSON L805", true, false)
        );
        assert_eq!(
            (got[1].name.as_str(), got[1].color, got[1].duplex),
            ("Brother DCP", false, true)
        );
    }
}
