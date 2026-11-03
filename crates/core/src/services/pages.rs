//! Page-range parsing ("1-3,5,8-") and sheet/price maths.

use crate::settings::Settings;

/// Parse a page range like `"1-3, 5, 8-"` against a document with `total` pages.
/// Empty / "all" means every page. Returns the selected 1-based page numbers in order.
pub fn parse_range(spec: &str, total: u32) -> Result<Vec<u32>, String> {
    let spec = spec.trim();
    if total == 0 {
        return Err("This document has no pages".into());
    }
    if spec.is_empty() || spec.eq_ignore_ascii_case("all") {
        return Ok((1..=total).collect());
    }
    let mut pages = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (a, b) = match part.split_once('-') {
            Some((a, b)) => {
                let a = if a.trim().is_empty() { 1 } else { num(a)? };
                let b = if b.trim().is_empty() { total } else { num(b)? };
                (a, b)
            }
            None => {
                let n = num(part)?;
                (n, n)
            }
        };
        if a == 0 || b == 0 || a > b || b > total {
            return Err(format!(
                "\"{part}\" is not valid — this document has {total} page{}",
                if total == 1 { "" } else { "s" }
            ));
        }
        pages.extend(a..=b);
    }
    if pages.is_empty() {
        return Err("Choose at least one page".into());
    }
    Ok(pages)
}

fn num(s: &str) -> Result<u32, String> {
    s.trim()
        .parse()
        .map_err(|_| format!("\"{}\" is not a page number", s.trim()))
}

/// Normalised range string for SumatraPDF (`1-3,5`), or None for all pages.
pub fn sumatra_range(pages: &[u32], total: u32) -> Option<String> {
    if pages.len() as u32 == total && pages.iter().copied().eq(1..=total) {
        return None;
    }
    let mut parts = Vec::new();
    let mut i = 0;
    while i < pages.len() {
        let start = pages[i];
        let mut end = start;
        while i + 1 < pages.len() && pages[i + 1] == end + 1 {
            end += 1;
            i += 1;
        }
        parts.push(if start == end {
            start.to_string()
        } else {
            format!("{start}-{end}")
        });
        i += 1;
    }
    Some(parts.join(","))
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Quote {
    /// Printed sides (pages × copies).
    pub sides: u32,
    /// Sheets of paper used.
    pub sheets: u32,
    pub price: f64,
}

pub fn quote(pages: u32, copies: u32, color: bool, duplex: bool, s: &Settings) -> Quote {
    let sides = pages * copies;
    let sheets_per_copy = if duplex { pages.div_ceil(2) } else { pages };
    let sheets = sheets_per_copy * copies;
    let price = match (color, duplex) {
        (false, false) => sides as f64 * s.price_bw_single,
        (true, false) => sides as f64 * s.price_color_single,
        (false, true) => sheets as f64 * s.price_bw_duplex,
        (true, true) => sheets as f64 * s.price_color_duplex,
    };
    Quote {
        sides,
        sheets,
        price: (price * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("", 3).unwrap(), vec![1, 2, 3]);
        assert_eq!(parse_range("all", 2).unwrap(), vec![1, 2]);
        assert_eq!(parse_range("1-3,5", 6).unwrap(), vec![1, 2, 3, 5]);
        assert_eq!(parse_range(" 2 , 4- ", 5).unwrap(), vec![2, 4, 5]);
        assert_eq!(parse_range("-2", 5).unwrap(), vec![1, 2]);
        assert!(parse_range("0", 5).is_err());
        assert!(parse_range("4-2", 5).is_err());
        assert!(parse_range("7", 5).is_err());
        assert!(parse_range("abc", 5).is_err());
        assert!(parse_range(",", 5).is_err());
    }

    #[test]
    fn sumatra_ranges() {
        assert_eq!(sumatra_range(&[1, 2, 3], 3), None);
        assert_eq!(sumatra_range(&[1, 2, 3, 5], 6).as_deref(), Some("1-3,5"));
        assert_eq!(sumatra_range(&[2], 6).as_deref(), Some("2"));
    }

    #[test]
    fn pricing() {
        let s = Settings::default(); // bw 2 / 3 duplex, colour 10 / 18 duplex
        assert_eq!(
            quote(5, 2, false, false, &s),
            Quote {
                sides: 10,
                sheets: 10,
                price: 20.0
            }
        );
        assert_eq!(
            quote(5, 2, false, true, &s),
            Quote {
                sides: 10,
                sheets: 6,
                price: 18.0
            }
        );
        assert_eq!(quote(1, 1, true, false, &s).price, 10.0);
        assert_eq!(
            quote(3, 1, true, true, &s),
            Quote {
                sides: 3,
                sheets: 2,
                price: 36.0
            }
        );
    }
}
