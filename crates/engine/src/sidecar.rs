//! Reading and writing `project.yaml`.
//!
//! - Reads tolerate unknown keys and keep them (`extra` maps) so other tools can extend the file.
//! - Writes are atomic: temp file in the same directory, then rename.
//! - Writes are guarded against external edits: the caller passes the modification stamp it
//!   read; if the file changed meanwhile the write is refused with `SidecarConflict`.

use crate::error::{io_err, EngineError, Result};
use crate::model::{Sidecar, SIDECAR_FILE_NAME};
pub use crate::model::SidecarStamp;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

trait StampExt {
    fn from_meta(m: &fs::Metadata) -> SidecarStamp;
}
impl StampExt for SidecarStamp {
    fn from_meta(m: &fs::Metadata) -> SidecarStamp {
        let mtime = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as i128)
            .unwrap_or(0);
        SidecarStamp { mtime_unix_nanos: mtime, size: m.len() }
    }
}

pub fn sidecar_path(project_dir: &Path) -> PathBuf {
    project_dir.join(SIDECAR_FILE_NAME)
}

/// `Ok(None)` when there is no sidecar; `Err(SidecarInvalid)` when it exists but does not parse.
pub fn read(project_dir: &Path) -> Result<Option<(Sidecar, SidecarStamp)>> {
    let path = sidecar_path(project_dir);
    let meta = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(EngineError::Io { path, source: e }),
    };
    let text = fs::read_to_string(&path).map_err(io_err(&path))?;
    let sidecar: Sidecar = serde_yaml_ng::from_str(&text).map_err(|e| EngineError::SidecarInvalid(e.to_string()))?;
    Ok(Some((sidecar, SidecarStamp::from_meta(&meta))))
}

/// Writes the sidecar atomically. `expected` is the stamp from the last read (`None` when the
/// caller believes no sidecar exists yet). Returns the new stamp.
pub fn write(project_dir: &Path, sidecar: &Sidecar, expected: Option<SidecarStamp>) -> Result<SidecarStamp> {
    let path = sidecar_path(project_dir);
    let current = match fs::metadata(&path) {
        Ok(m) => Some(SidecarStamp::from_meta(&m)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(EngineError::Io { path, source: e }),
    };
    if current != expected {
        return Err(EngineError::SidecarConflict);
    }
    let text = serde_yaml_ng::to_string(sidecar).map_err(|e| EngineError::Serde(e.to_string()))?;
    let tmp = project_dir.join(format!(".{SIDECAR_FILE_NAME}.{}.tmp", std::process::id()));
    fs::write(&tmp, text.as_bytes()).map_err(io_err(&tmp))?;
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(EngineError::Io { path, source: e });
    }
    let meta = fs::metadata(&path).map_err(io_err(&path))?;
    Ok(SidecarStamp::from_meta(&meta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Metadata;

    #[test]
    fn roundtrip_preserves_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("project.yaml"),
            "schema: 1\nmetadata:\n  title: Bin\n  tags: [a, b]\n  custom_field: keep me\ntop_level_extra:\n  nested: 42\n",
        )
        .unwrap();
        let (mut sc, stamp) = read(dir.path()).unwrap().unwrap();
        assert_eq!(sc.metadata.title.as_deref(), Some("Bin"));
        assert_eq!(sc.metadata.tags, vec!["a", "b"]);
        sc.metadata.tags.push("c".into());
        write(dir.path(), &sc, Some(stamp)).unwrap();
        let text = fs::read_to_string(dir.path().join("project.yaml")).unwrap();
        assert!(text.contains("custom_field: keep me"), "{text}");
        assert!(text.contains("top_level_extra:"), "{text}");
        assert!(text.contains("- c"), "{text}");
    }

    #[test]
    fn refuses_to_overwrite_external_change() {
        let dir = tempfile::tempdir().unwrap();
        let sc = Sidecar { metadata: Metadata { title: Some("A".into()), ..Default::default() }, ..Default::default() };
        let stamp = write(dir.path(), &sc, None).unwrap();
        // external edit with a different size guarantees a different stamp even on coarse mtimes
        fs::write(dir.path().join("project.yaml"), "schema: 1\nmetadata:\n  title: Edited elsewhere with more bytes\n").unwrap();
        let err = write(dir.path(), &sc, Some(stamp)).unwrap_err();
        assert!(matches!(err, EngineError::SidecarConflict));
        // and a stale "no sidecar" belief is refused as well
        assert!(matches!(write(dir.path(), &sc, None).unwrap_err(), EngineError::SidecarConflict));
    }

    #[test]
    fn malformed_is_reported_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("project.yaml"), "metadata: [this is not a mapping").unwrap();
        assert!(matches!(read(dir.path()), Err(EngineError::SidecarInvalid(_))));
    }
}
