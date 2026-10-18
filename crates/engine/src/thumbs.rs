//! Thumbnail policy: which file a project's preview comes from, and where the cached PNG
//! lives. Thumbnails are reproducible, so the cache (`<data dir>/thumbs/`) is disposable.
//! A thumbnail is valid while its source file keeps size and mtime; the index compares
//! those on every list, so a replaced model file simply re-enters the queue.

use crate::error::{io_err, EngineError, Result};
use crate::model::{FileEntry, FileKind, ThumbSource};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const RENDERABLE: &[&str] = &["stl", "obj", "3mf"];

fn ext_of(name: &str) -> String {
    name.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}

/// Picks the thumbnail source for a project, in order: the image named by the sidecar's
/// `thumbnail:` key, a 3MF with an embedded preview (no rendering needed), the largest
/// renderable model, and finally the first image in the project.
pub fn choose_source(files: &[FileEntry], sidecar_thumbnail: Option<&str>) -> Option<(String, ThumbSource)> {
    if let Some(rel) = sidecar_thumbnail {
        let rel = rel.trim().trim_start_matches("./");
        if let Some(f) = files.iter().find(|f| f.rel_path == rel && f.kind == FileKind::Image) {
            return Some((f.rel_path.clone(), ThumbSource::Image));
        }
    }
    if let Some(f) = files.iter().find(|f| f.embedded_thumbnail) {
        return Some((f.rel_path.clone(), ThumbSource::Embedded));
    }
    if let Some(f) = files
        .iter()
        .filter(|f| f.kind == FileKind::Model && RENDERABLE.contains(&ext_of(&f.name).as_str()))
        .max_by_key(|f| f.size)
    {
        return Some((f.rel_path.clone(), ThumbSource::Render));
    }
    files
        .iter()
        .find(|f| f.kind == FileKind::Image)
        .map(|f| (f.rel_path.clone(), ThumbSource::Image))
}

/// Deterministic cache file name for a (project, source) pair, so re-rendering overwrites
/// instead of accumulating files.
pub fn key_for(project_id: &str, source_rel: &str) -> String {
    let mut h = Sha256::new();
    h.update(project_id.as_bytes());
    h.update([0]);
    h.update(source_rel.as_bytes());
    format!("{:x}", h.finalize())[..24].to_string() + ".png"
}

pub fn is_valid_key(key: &str) -> bool {
    key.len() == 28 && key.ends_with(".png") && key[..24].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("thumbs")
}

pub fn path_for(data_dir: &Path, key: &str) -> Result<PathBuf> {
    if !is_valid_key(key) {
        return Err(EngineError::InvalidName(format!("thumbnail key {key}")));
    }
    Ok(cache_dir(data_dir).join(key))
}

/// Writes PNG bytes atomically into the cache.
pub fn write(data_dir: &Path, key: &str, png: &[u8]) -> Result<PathBuf> {
    if png.len() < 8 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(EngineError::InvalidName("thumbnail is not a PNG".into()));
    }
    let dir = cache_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(io_err(&dir))?;
    let path = path_for(data_dir, key)?;
    let tmp = dir.join(format!(".{key}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, png).map_err(io_err(&tmp))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(EngineError::Io { path, source: e });
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::OffsetDateTime;

    fn f(name: &str, size: u64, embedded: bool) -> FileEntry {
        FileEntry {
            rel_path: name.into(),
            name: name.rsplit('/').next().unwrap().into(),
            kind: FileKind::from_extension(name.rsplit('.').next().unwrap()),
            size,
            modified: OffsetDateTime::UNIX_EPOCH,
            slicer: None,
            embedded_thumbnail: embedded,
        }
    }

    #[test]
    fn source_priority() {
        let files = vec![
            f("small.stl", 10, false),
            f("big.obj", 500, false),
            f("photo.jpg", 50, false),
            f("plate.3mf", 100, true),
        ];
        assert_eq!(choose_source(&files, None), Some(("plate.3mf".into(), ThumbSource::Embedded)));
        assert_eq!(
            choose_source(&files, Some("photo.jpg")),
            Some(("photo.jpg".into(), ThumbSource::Image))
        );
        assert_eq!(
            choose_source(&files, Some("missing.png")),
            Some(("plate.3mf".into(), ThumbSource::Embedded))
        );
        let no_embedded = vec![f("small.stl", 10, false), f("big.obj", 500, false), f("part.step", 9000, false)];
        assert_eq!(choose_source(&no_embedded, None), Some(("big.obj".into(), ThumbSource::Render)));
        assert_eq!(
            choose_source(&[f("x.png", 1, false)], None),
            Some(("x.png".into(), ThumbSource::Image))
        );
        assert_eq!(choose_source(&[f("x.step", 1, false)], None), None);
    }

    #[test]
    fn keys_are_stable_and_validated() {
        let k = key_for("r1:A/B", "big.stl");
        assert_eq!(k, key_for("r1:A/B", "big.stl"));
        assert_ne!(k, key_for("r1:A/B", "other.stl"));
        assert!(is_valid_key(&k));
        assert!(!is_valid_key("../../etc/passwd"));
        assert!(!is_valid_key("zz.png"));
        let t = tempfile::tempdir().unwrap();
        assert!(write(t.path(), &k, b"not png").is_err());
        let p = write(t.path(), &k, crate::threemf::tests::TINY_PNG).unwrap();
        assert!(p.is_file());
        assert!(path_for(t.path(), "..").is_err());
    }
}
