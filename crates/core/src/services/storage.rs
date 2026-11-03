//! Where customer files live on disk:
//! `<data>/storage/<YYYY-MM-DD>/<CODE>/{original,pdf}/`

use std::path::{Path, PathBuf};

pub fn storage_root(data_dir: &Path) -> PathBuf {
    data_dir.join("storage")
}

/// Relative (to the storage root) folder for a job, e.g. `2026-11-04/A-007`.
pub fn job_rel_dir(date: &str, code: &str) -> String {
    format!("{date}/{code}")
}

pub fn original_dir(data_dir: &Path, job_rel: &str) -> PathBuf {
    storage_root(data_dir).join(job_rel).join("original")
}

pub fn pdf_dir(data_dir: &Path, job_rel: &str) -> PathBuf {
    storage_root(data_dir).join(job_rel).join("pdf")
}

/// Make an uploaded filename safe to store: no paths, no control or reserved characters,
/// no Windows device names, bounded length, never empty.
pub fn sanitize_filename(name: &str) -> String {
    // Browsers may send a full path ("C:\fakepath\x.pdf").
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut out: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '/' | '\\' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    out = out
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' '])
        .to_string();

    let (stem, ext) = split_ext(&out);
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let mut stem: String = stem.chars().take(80).collect();
    if stem.is_empty() || reserved.contains(&stem.to_ascii_uppercase().as_str()) {
        stem = format!("file_{stem}");
    }
    let ext: String = ext.chars().take(10).collect();
    if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    }
}

/// Lower-case extension without the dot.
pub fn extension(name: &str) -> String {
    split_ext(name).1.to_ascii_lowercase()
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i + 1..]),
        _ => (name, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes() {
        assert_eq!(sanitize_filename("report.pdf"), "report.pdf");
        assert_eq!(sanitize_filename("C:\\fakepath\\My CV.docx"), "My CV.docx");
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("..hidden.txt"), "hidden.txt");
        assert_eq!(sanitize_filename("a<b>:c?.png"), "a_b__c_.png");
        assert_eq!(sanitize_filename("CON.txt"), "file_CON.txt");
        assert_eq!(sanitize_filename(""), "file_");
        assert_eq!(sanitize_filename("नेपाली फाइल.pdf"), "नेपाली फाइल.pdf");
        assert!(sanitize_filename(&"x".repeat(500)).len() <= 90);
    }

    #[test]
    fn extensions() {
        assert_eq!(extension("A.PDF"), "pdf");
        assert_eq!(extension("noext"), "");
        assert_eq!(extension(".bashrc"), "");
    }
}
