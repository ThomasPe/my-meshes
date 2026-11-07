//! The diagnostics package (APP-8): one zip a user saves and attaches to a bug report, so
//! a problem in the field can be analysed without telemetry (the spec forbids crash upload
//! and anything sent in the background). It holds the app log and its rotated predecessors,
//! `settings.json` and `roots.json`, an environment block the shell writes, and a listing of
//! the app data directory. Secrets never go in: keys named like a token or a key are
//! replaced, and user folders are shortened to `~` in every text (the log already names the
//! user's download and library folders).

use crate::error::{io_err, Result};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

/// What the shell hands over; everything is optional but the output path.
pub struct Sources {
    /// The log directory; every `meshkeep*.log` in it is included.
    pub log_dir: Option<PathBuf>,
    /// The app data directory: `settings.json`, `roots.json` and a listing come from here.
    pub data_dir: PathBuf,
    /// Version, OS, WebView, library size, MCP state: whatever the shell knows.
    pub environment: String,
    /// The user's home directory, shortened to `~` in every text.
    pub home: Option<PathBuf>,
}

/// What the UI shows after the export.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub path: PathBuf,
    pub entries: Vec<String>,
    pub bytes: u64,
}

/// `meshkeep-diagnostics-20261107-1530.zip`
pub fn file_name(now: OffsetDateTime) -> String {
    format!(
        "meshkeep-diagnostics-{:04}{:02}{:02}-{:02}{:02}.zip",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute()
    )
}

/// Writes the package to `out` (replaced if it exists) and says what went in.
pub fn write_package(out: &Path, src: &Sources) -> Result<DiagnosticsReport> {
    let file = fs::File::create(out).map_err(io_err(out))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut entries = Vec::new();
    let home = src.home.as_deref();
    let mut put = |zip: &mut zip::ZipWriter<fs::File>, name: &str, text: &str| -> Result<()> {
        zip.start_file(name, opts).map_err(|e| zip_err(out, e))?;
        zip.write_all(text.as_bytes()).map_err(io_err(out))?;
        entries.push(name.to_string());
        Ok(())
    };

    put(&mut zip, "environment.txt", &redact(&src.environment, home))?;
    if let Some(dir) = &src.log_dir {
        for path in log_files(dir) {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            match fs::read_to_string(&path) {
                Ok(text) => put(&mut zip, &format!("logs/{name}"), &redact(&text, home))?,
                Err(e) => put(&mut zip, &format!("logs/{name}.missing.txt"), &format!("{}: {e}\n", path.display()))?,
            }
        }
    }
    for name in ["settings.json", "roots.json"] {
        let path = src.data_dir.join(name);
        match fs::read_to_string(&path) {
            Ok(text) => put(&mut zip, name, &redact_json_text(&text, home))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => put(&mut zip, &format!("{name}.missing.txt"), &format!("{}: {e}\n", path.display()))?,
        }
    }
    put(&mut zip, "data-dir.txt", &data_dir_listing(&src.data_dir))?;
    let file = zip.finish().map_err(|e| zip_err(out, e))?;
    let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
    Ok(DiagnosticsReport {
        path: out.to_path_buf(),
        entries,
        bytes,
    })
}

fn zip_err(path: &Path, e: zip::result::ZipError) -> crate::error::EngineError {
    crate::error::EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::other(e.to_string()),
    }
}

/// `meshkeep.log` and its rotated predecessors, oldest first.
fn log_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    name.starts_with("meshkeep") && name.ends_with(".log") && p.is_file()
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Names and sizes of what lives in the app data directory (no content): tells whether the
/// index grew, how many previews there are, whether an AI cache exists.
fn data_dir_listing(dir: &Path) -> String {
    let mut out = String::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return format!("{} not readable\n", dir.display());
    };
    let mut rows: Vec<(String, String)> = rd
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let p = e.path();
            let what = if p.is_dir() {
                let n = fs::read_dir(&p).map(|d| d.count()).unwrap_or(0);
                format!("dir, {n} entries")
            } else {
                format!("{} bytes", e.metadata().map(|m| m.len()).unwrap_or(0))
            };
            (name, what)
        })
        .collect();
    rows.sort();
    for (name, what) in rows {
        out.push_str(&format!("{name}\t{what}\n"));
    }
    out
}

/// Shortens the home directory and any `/home/<name>`, `/Users/<name>` or `C:\Users\<name>`
/// to `~`, in logs and in the environment block.
pub fn redact(text: &str, home: Option<&Path>) -> String {
    let mut out = text.to_string();
    if let Some(home) = home {
        let h = home.to_string_lossy().into_owned();
        if h.len() > 3 {
            for variant in [h.clone(), h.replace('\\', "/"), h.replace('/', "\\")] {
                out = out.replace(&variant, "~");
            }
        }
    }
    redact_user_dirs(&out)
}

fn redact_user_dirs(text: &str) -> String {
    const PATTERNS: [&str; 3] = ["/home/", "/Users/", "\\Users\\"];
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let found = PATTERNS
            .iter()
            .filter_map(|p| rest.find(p).map(|i| (i, *p)))
            .min_by_key(|(i, _)| *i);
        let Some((i, pat)) = found else {
            out.push_str(rest);
            return out;
        };
        let after = &rest[i + pat.len()..];
        let name_len = after.find(['/', '\\', '\n', '\r', '"', '\'']).unwrap_or(after.len());
        if name_len == 0 {
            out.push_str(&rest[..i + pat.len()]);
            rest = after;
            continue;
        }
        let mut start = i;
        // the drive letter in front of `C:\Users\name` and `C:/Users/name`
        let b = rest.as_bytes();
        if pat != "/home/" && start >= 2 && b[start - 1] == b':' && b[start - 2].is_ascii_alphabetic() {
            start -= 2;
        }
        out.push_str(&rest[..start]);
        out.push('~');
        rest = &after[name_len..];
    }
}

/// A JSON file with secrets replaced and paths shortened; unparsable text is redacted as text.
fn redact_json_text(text: &str, home: Option<&Path>) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(mut v) => {
            redact_json(&mut v, home);
            serde_json::to_string_pretty(&v).unwrap_or_default() + "\n"
        }
        Err(_) => redact(text, home),
    }
}

/// Values under a key that smells like a secret become `"<redacted>"`; every other string
/// gets its user folders shortened.
pub fn redact_json(value: &mut Value, home: Option<&Path>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if is_secret_key(k) {
                    if !v.is_null() {
                        *v = Value::String("<redacted>".into());
                    }
                } else {
                    redact_json(v, home);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| redact_json(v, home)),
        Value::String(s) => *s = redact(s, home),
        _ => {}
    }
}

fn is_secret_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["token", "secret", "password", "api_key", "apikey", "credential"]
        .iter()
        .any(|w| k.contains(w))
        || k == "key"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn user_folders_become_tilde() {
        let home = Path::new("C:\\Users\\thomas");
        assert_eq!(redact("scan C:\\Users\\thomas\\Models done", Some(home)), "scan ~\\Models done");
        assert_eq!(redact("at C:/Users/thomas/Models", Some(home)), "at ~/Models");
        assert_eq!(
            redact("other D:\\Users\\Anna Lena\\Downloads\\x.zip", Some(home)),
            "other ~\\Downloads\\x.zip"
        );
        assert_eq!(redact("/home/tp/lib and /Users/tp/lib", None), "~/lib and ~/lib");
        assert_eq!(redact("\"/home/tp\"", None), "\"~\"");
        assert_eq!(redact("/home/", None), "/home/");
        assert_eq!(redact("nothing here", Some(Path::new("/"))), "nothing here");
    }

    #[test]
    fn secrets_leave_json_and_paths_shrink() {
        let mut v = serde_json::json!({
            "mcp": { "enabled": true, "token": "mk_abc", "import_dirs": ["C:\\Users\\tp\\Downloads"] },
            "ai": { "model": "claude", "api_key": null },
            "nested": [{ "Secret": "x" }, { "key": "y" }, { "monkey": "stays" }],
        });
        redact_json(&mut v, Some(Path::new("C:\\Users\\tp")));
        assert_eq!(v["mcp"]["token"], "<redacted>");
        assert_eq!(v["mcp"]["enabled"], true);
        assert_eq!(v["mcp"]["import_dirs"][0], "~\\Downloads");
        assert!(v["ai"]["api_key"].is_null(), "null stays null");
        assert_eq!(v["nested"][0]["Secret"], "<redacted>");
        assert_eq!(v["nested"][1]["key"], "<redacted>");
        assert_eq!(v["nested"][2]["monkey"], "stays");
    }

    #[test]
    fn package_holds_logs_settings_and_environment_without_the_token() {
        let data = tempfile::tempdir().unwrap();
        let logs = tempfile::tempdir().unwrap();
        fs::write(logs.path().join("meshkeep.log"), "[INFO] scanning /home/tp/Models\n").unwrap();
        fs::write(logs.path().join("meshkeep_2026-11-01.log"), "[INFO] older\n").unwrap();
        fs::write(logs.path().join("other.txt"), "not a log").unwrap();
        fs::write(
            data.path().join("settings.json"),
            r#"{ "schema": 1, "mcp": { "token": "mk_secret", "import_dirs": ["/home/tp/Downloads"] } }"#,
        )
        .unwrap();
        fs::write(data.path().join("index.sqlite"), vec![0u8; 100]).unwrap();
        fs::create_dir_all(data.path().join("thumbs")).unwrap();
        let out = data.path().join("diag.zip");
        let report = write_package(
            &out,
            &Sources {
                log_dir: Some(logs.path().to_path_buf()),
                data_dir: data.path().to_path_buf(),
                environment: "Meshkeep 0.1.0\nData dir /home/tp/.local/share/meshkeep\n".into(),
                home: Some(PathBuf::from("/home/tp")),
            },
        )
        .unwrap();
        assert_eq!(
            report.entries,
            [
                "environment.txt",
                "logs/meshkeep.log",
                "logs/meshkeep_2026-11-01.log",
                "settings.json",
                "data-dir.txt"
            ]
        );
        assert!(report.bytes > 0);
        let mut zip = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap();
        let read = |zip: &mut zip::ZipArchive<fs::File>, name: &str| {
            let mut s = String::new();
            zip.by_name(name).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        assert_eq!(read(&mut zip, "logs/meshkeep.log"), "[INFO] scanning ~/Models\n");
        assert_eq!(
            read(&mut zip, "environment.txt"),
            "Meshkeep 0.1.0\nData dir ~/.local/share/meshkeep\n"
        );
        let settings = read(&mut zip, "settings.json");
        assert!(!settings.contains("mk_secret"), "{settings}");
        assert!(
            settings.contains("\"<redacted>\"") && settings.contains("~/Downloads"),
            "{settings}"
        );
        let listing = read(&mut zip, "data-dir.txt");
        assert!(
            listing.contains("index.sqlite\t100 bytes") && listing.contains("thumbs\tdir, 0 entries"),
            "{listing}"
        );
        assert!(
            !listing.contains("diag.zip\t0") || listing.contains("diag.zip"),
            "the package itself may be listed"
        );
        assert!(file_name(time::macros::datetime!(2026-11-07 15:30 UTC)).eq("meshkeep-diagnostics-20261107-1530.zip"));
    }
}
