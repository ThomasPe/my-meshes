//! Packed projects (LIB-9): a project whose models stay inside a zip archive. The sidecar's
//! `packed:` key names the archive in the project folder; the scanner lists its entries as
//! the project's files (`<archive>/<entry path>`), and everything that needs a file's bytes
//! (viewer, previews, hashing, hints) reads the entry straight from the archive. Nothing is
//! extracted until the user asks: opening a file with another app copies that one entry to
//! a cache, "unpack" extracts everything back into the folder.
//!
//! Only zip: its directory gives random access to single entries. 7z archives are usually
//! solid (one stream), so reading one model would mean decompressing everything before it.

use crate::error::{io_err, EngineError, Result};
use crate::model::{FileEntry, FileKind};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use time::OffsetDateTime;

/// Zip comment of archives `write_archive` creates: their entry paths are project-relative,
/// so unpacking never strips a top-level folder (a download bundle's single folder is).
pub const PACK_COMMENT: &str = "Meshkeep pack v1";

/// One file inside a packed archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedEntry {
    /// Path inside the archive, forward slashes.
    pub name: String,
    /// Uncompressed size.
    pub size: u64,
}

fn zip_err(path: &Path) -> impl FnOnce(zip::result::ZipError) -> EngineError + '_ {
    move |e| EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    }
}

fn open(path: &Path) -> Result<zip::ZipArchive<File>> {
    let f = File::open(path).map_err(io_err(path))?;
    zip::ZipArchive::new(f).map_err(zip_err(path))
}

pub fn is_zip_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".zip")
}

/// A relative path with only normal components; what an entry may be called.
fn safe_name(name: &str) -> bool {
    let p = Path::new(name);
    !name.is_empty() && !p.is_absolute() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

fn junk(name: &str) -> bool {
    name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") || name.ends_with("Thumbs.db")
}

/// The archive's file entries (no directories, no macOS/Windows droppings, no unsafe paths).
pub fn list_entries(archive: &Path) -> Result<Vec<PackedEntry>> {
    let mut zip = open(archive)?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let Ok(entry) = zip.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        let Ok(name) = entry.name().map(|n| n.replace('\\', "/")) else {
            continue;
        };
        if junk(&name) || !safe_name(&name) {
            continue;
        }
        out.push(PackedEntry { name, size: entry.size() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name);
    Ok(out)
}

/// Whether the archive was written by `write_archive`.
pub fn is_own_pack(archive: &Path) -> bool {
    open(archive).map(|z| z.comment() == PACK_COMMENT.as_bytes()).unwrap_or(false)
}

/// The entries as project files: `<archive rel>/<entry>`, kind from the extension, the
/// archive's own modification time (so previews go stale when the archive changes).
pub fn as_files(archive_rel: &str, modified: OffsetDateTime, entries: &[PackedEntry]) -> Vec<FileEntry> {
    entries
        .iter()
        .map(|e| {
            let name = e.name.rsplit('/').next().unwrap_or(&e.name).to_string();
            let kind = name
                .rsplit_once('.')
                .map(|(_, ext)| FileKind::from_extension(ext))
                .unwrap_or(FileKind::Other);
            FileEntry {
                rel_path: format!("{archive_rel}/{}", e.name),
                name,
                kind,
                size: e.size,
                modified,
                slicer: None,
                embedded_thumbnail: false,
            }
        })
        .collect()
}

fn index_of(zip: &zip::ZipArchive<File>, entry: &str) -> Option<usize> {
    (0..zip.len()).find(|&i| {
        zip.name_for_index(i)
            .and_then(|n| n.ok())
            .map(|n| n.replace('\\', "/") == entry)
            .unwrap_or(false)
    })
}

fn not_found(archive: &Path, entry: &str) -> EngineError {
    EngineError::Io {
        path: archive.join(entry),
        source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file in the archive"),
    }
}

/// Streams one entry into `out`; returns the bytes written. The zip reader checks the CRC.
pub fn copy_entry(archive: &Path, entry: &str, out: &mut dyn Write, max: Option<u64>) -> Result<u64> {
    let mut zip = open(archive)?;
    let i = index_of(&zip, entry).ok_or_else(|| not_found(archive, entry))?;
    let file = zip.by_index(i).map_err(zip_err(archive))?;
    let mut reader: Box<dyn Read> = match max {
        Some(m) => Box::new(file.take(m)),
        None => Box::new(file),
    };
    std::io::copy(&mut reader, out).map_err(io_err(archive))
}

pub fn read_entry(archive: &Path, entry: &str) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    copy_entry(archive, entry, &mut buf, None)?;
    Ok(buf)
}

/// At most `max` bytes from the start of an entry (readme text for hints).
pub fn read_entry_head(archive: &Path, entry: &str, max: u64) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    copy_entry(archive, entry, &mut buf, Some(max))?;
    Ok(buf)
}

struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.update(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// SHA-256 of an entry's uncompressed bytes: the same value its extracted file would have.
pub fn sha256_entry(archive: &Path, entry: &str) -> Result<String> {
    let mut h = HashWriter(Sha256::new());
    copy_entry(archive, entry, &mut h, None)?;
    Ok(format!("{:x}", h.0.finalize()))
}

/// Where a project file lives: on disk, or inside the project's packed archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Located {
    Disk(PathBuf),
    Packed { archive: PathBuf, entry: String },
}

impl Located {
    pub fn read(&self) -> Result<Vec<u8>> {
        match self {
            Located::Disk(p) => std::fs::read(p).map_err(io_err(p)),
            Located::Packed { archive, entry } => read_entry(archive, entry),
        }
    }

    pub fn read_head(&self, max: u64) -> Result<Vec<u8>> {
        match self {
            Located::Disk(p) => {
                let f = File::open(p).map_err(io_err(p))?;
                let mut buf = Vec::new();
                f.take(max).read_to_end(&mut buf).map_err(io_err(p))?;
                Ok(buf)
            }
            Located::Packed { archive, entry } => read_entry_head(archive, entry, max),
        }
    }

    pub fn sha256(&self) -> Result<String> {
        match self {
            Located::Disk(p) => crate::hash::sha256_file(p),
            Located::Packed { archive, entry } => sha256_entry(archive, entry),
        }
    }

    /// A real path another program can open: the file itself, or a copy of the entry below
    /// `cache_dir` (keyed by archive, entry and the archive's state, so it is reused until
    /// the archive changes).
    pub fn materialize(&self, cache_dir: &Path) -> Result<PathBuf> {
        match self {
            Located::Disk(p) => Ok(p.clone()),
            Located::Packed { archive, entry } => {
                let meta = std::fs::metadata(archive).map_err(io_err(archive))?;
                let mut h = Sha256::new();
                h.update(archive.to_string_lossy().as_bytes());
                h.update([0]);
                h.update(entry.as_bytes());
                h.update(meta.len().to_le_bytes());
                if let Ok(m) = meta.modified() {
                    h.update(format!("{m:?}").as_bytes());
                }
                let key = &format!("{:x}", h.finalize())[..16];
                let name = entry.rsplit('/').next().unwrap_or(entry);
                let dir = cache_dir.join(key);
                let out = dir.join(name);
                if out.is_file() {
                    return Ok(out);
                }
                std::fs::create_dir_all(&dir).map_err(io_err(&dir))?;
                let tmp = dir.join(format!(".{name}.tmp"));
                let result = (|| {
                    let mut f = File::create(&tmp).map_err(io_err(&tmp))?;
                    copy_entry(archive, entry, &mut f, None)?;
                    f.flush().map_err(io_err(&tmp))?;
                    drop(f);
                    std::fs::rename(&tmp, &out).map_err(io_err(&out))
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(&tmp);
                }
                result.map(|_| out)
            }
        }
    }
}

/// The single top-level folder every entry sits in, if there is one (what a download bundle
/// wraps its content in); `None` for archives this app packed.
pub fn strip_prefix(archive: &Path, entries: &[PackedEntry]) -> Option<String> {
    if is_own_pack(archive) {
        return None;
    }
    let mut tops: Vec<&str> = entries.iter().filter_map(|e| e.name.split_once('/').map(|(t, _)| t)).collect();
    tops.sort();
    tops.dedup();
    let all_nested = entries.iter().all(|e| e.name.contains('/'));
    if tops.len() == 1 && all_nested {
        Some(tops[0].to_string())
    } else {
        None
    }
}

/// Where an entry lands when the archive is unpacked into the project folder.
pub fn unpacked_rel(entry: &str, strip: Option<&str>) -> String {
    match strip {
        Some(s) => entry.strip_prefix(&format!("{s}/")).unwrap_or(entry).to_string(),
        None => entry.to_string(),
    }
}

/// Extracts every entry into `target` (which must not hold any of them yet), reporting each
/// file. Returns the relative paths written.
pub fn extract_all(
    archive: &Path,
    entries: &[PackedEntry],
    strip: Option<&str>,
    target: &Path,
    mut progress: impl FnMut(usize, &str),
) -> Result<Vec<String>> {
    let mut written = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let rel = unpacked_rel(&e.name, strip);
        if !safe_name(&rel) {
            continue;
        }
        progress(i, &rel);
        let out = target.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(io_err(parent))?;
        }
        let mut f = File::create(&out).map_err(io_err(&out))?;
        let n = copy_entry(archive, &e.name, &mut f, None)?;
        if n != e.size {
            return Err(EngineError::Io {
                path: out,
                source: std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    format!("{} holds {} bytes, {n} were read", e.name, e.size),
                ),
            });
        }
        written.push(rel);
    }
    Ok(written)
}

/// Writes `rels` (paths below `base`) into a new deflate archive at `archive`, entry names
/// equal to the relative paths. The archive is written next to its final place and renamed,
/// so a half-written file never carries the final name.
pub fn write_archive(archive: &Path, base: &Path, rels: &[String], mut progress: impl FnMut(usize, &str)) -> Result<()> {
    let tmp = archive.with_extension("zip.tmp");
    let result = (|| -> Result<()> {
        let f = File::create(&tmp).map_err(io_err(&tmp))?;
        let mut zip = zip::ZipWriter::new(f);
        zip.set_comment(PACK_COMMENT).map_err(zip_err(&tmp))?;
        for (i, rel) in rels.iter().enumerate() {
            progress(i, rel);
            let src = base.join(rel);
            let meta = std::fs::metadata(&src).map_err(io_err(&src))?;
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .compression_level(Some(6))
                .large_file(meta.len() >= u32::MAX as u64);
            zip.start_file(rel.as_str(), options).map_err(zip_err(&tmp))?;
            let mut input = File::open(&src).map_err(io_err(&src))?;
            std::io::copy(&mut input, &mut zip).map_err(io_err(&tmp))?;
        }
        let f = zip.finish().map_err(zip_err(&tmp))?;
        f.sync_all().map_err(io_err(&tmp))?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, archive).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        EngineError::Io {
            path: archive.to_path_buf(),
            source: e,
        }
    })
}

/// Reads every entry back (the zip reader verifies each CRC) and compares its hash with the
/// file on disk. Only after this may the loose files go.
pub fn verify_archive(archive: &Path, base: &Path, rels: &[String]) -> Result<()> {
    for rel in rels {
        let packed = sha256_entry(archive, rel)?;
        let disk = crate::hash::sha256_file(&base.join(rel))?;
        if packed != disk {
            return Err(EngineError::NotAllowed(format!(
                "{rel} reads differently from the archive than from disk; nothing was removed"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    }

    #[test]
    fn write_list_read_hash_and_extract_round_trip() {
        let t = tempfile::tempdir().unwrap();
        let base = t.path().join("proj");
        let big = vec![b'a'; 200_000]; // compresses well, like an ASCII STL
        write(&base.join("files/part a.stl"), &big);
        write(&base.join("top.stl"), b"solid top");
        let rels = vec!["files/part a.stl".to_string(), "top.stl".to_string()];
        let archive = base.join("proj.zip");
        let mut seen = Vec::new();
        write_archive(&archive, &base, &rels, |i, n| seen.push((i, n.to_string()))).unwrap();
        assert_eq!(seen.len(), 2);
        assert!(!base.join("proj.zip.tmp").exists());
        assert!(std::fs::metadata(&archive).unwrap().len() < 20_000, "deflate shrinks it");
        verify_archive(&archive, &base, &rels).unwrap();
        assert!(is_own_pack(&archive));

        let entries = list_entries(&archive).unwrap();
        assert_eq!(
            entries.iter().map(|e| (e.name.as_str(), e.size)).collect::<Vec<_>>(),
            vec![("files/part a.stl", 200_000), ("top.stl", 9)]
        );
        assert_eq!(strip_prefix(&archive, &entries), None, "own packs keep their layout");
        assert_eq!(read_entry(&archive, "top.stl").unwrap(), b"solid top");
        assert_eq!(read_entry_head(&archive, "files/part a.stl", 5).unwrap(), b"aaaaa");
        assert!(read_entry(&archive, "nope.stl").is_err());
        assert_eq!(
            sha256_entry(&archive, "files/part a.stl").unwrap(),
            crate::hash::sha256_file(&base.join("files/part a.stl")).unwrap()
        );

        let files = as_files("proj.zip", OffsetDateTime::UNIX_EPOCH, &entries);
        assert_eq!(files[0].rel_path, "proj.zip/files/part a.stl");
        assert_eq!(files[0].name, "part a.stl");
        assert_eq!(files[0].kind, FileKind::Model);

        let out = t.path().join("out");
        let written = extract_all(&archive, &entries, None, &out, |_, _| {}).unwrap();
        assert_eq!(written, rels);
        assert_eq!(std::fs::read(out.join("files/part a.stl")).unwrap(), big);

        // a changed file on disk is caught before anything would be removed
        std::fs::write(base.join("top.stl"), b"solid CHANGED").unwrap();
        assert!(verify_archive(&archive, &base, &rels).is_err());
    }

    #[test]
    fn download_bundles_lose_their_wrapper_folder_and_junk() {
        let t = tempfile::tempdir().unwrap();
        let archive = t.path().join("Cable Clip.zip");
        let f = File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        for (name, body) in [
            ("Cable Clip/files/clip.stl", &b"solid clip"[..]),
            ("Cable Clip/README.txt", b"by PrintTools"),
            ("__MACOSX/Cable Clip/._clip.stl", b"junk"),
            ("Cable Clip/.DS_Store", b"junk"),
        ] {
            zip.start_file(name, o).unwrap();
            zip.write_all(body).unwrap();
        }
        zip.add_directory("Cable Clip/empty/", o).unwrap();
        zip.finish().unwrap();

        let entries = list_entries(&archive).unwrap();
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["Cable Clip/README.txt", "Cable Clip/files/clip.stl"]
        );
        assert!(!is_own_pack(&archive));
        assert_eq!(strip_prefix(&archive, &entries).as_deref(), Some("Cable Clip"));
        assert_eq!(unpacked_rel("Cable Clip/files/clip.stl", Some("Cable Clip")), "files/clip.stl");

        // one entry for another program: copied once, reused while the archive is unchanged
        let cache = t.path().join("cache");
        let loc = Located::Packed {
            archive: archive.clone(),
            entry: "Cable Clip/files/clip.stl".into(),
        };
        let p1 = loc.materialize(&cache).unwrap();
        assert_eq!(p1.file_name().unwrap(), "clip.stl");
        assert_eq!(std::fs::read(&p1).unwrap(), b"solid clip");
        assert_eq!(loc.materialize(&cache).unwrap(), p1);
        assert_eq!(loc.read().unwrap(), b"solid clip");
        assert_eq!(loc.read_head(5).unwrap(), b"solid");
        let disk = Located::Disk(archive.clone());
        assert_eq!(disk.materialize(&cache).unwrap(), archive);
    }
}
