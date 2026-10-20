//! Domain types shared by the engine, the Tauri commands and (mirrored by hand) the frontend.
//! See `docs/spec/02-domain-model.md`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use time::OffsetDateTime;

pub const SIDECAR_FILE_NAME: &str = "project.yaml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncMode {
    Watch,
    Poll,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RootStatus {
    Online,
    Offline,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryRoot {
    pub id: String,
    pub path: PathBuf,
    pub mode: SyncMode,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub added_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_scan_at: Option<OffsetDateTime>,
    #[serde(default = "default_status")]
    pub status: RootStatus,
    /// Outcome of the last successful scan (LIB-6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_scan: Option<ScanSummary>,
    /// Last sync problem (scan failure, watcher that could not start); cleared by a good scan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Compact record of a scan, kept per root in `roots.json` for the status view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScanSummary {
    pub projects: u32,
    pub files: u32,
    pub ignored: u32,
    /// First warnings (capped) so the status log stays small.
    #[serde(default)]
    pub warnings: Vec<String>,
    pub warning_count: u32,
    pub millis: u64,
    /// What triggered it: "manual", "watch", "poll", "import", "startup".
    #[serde(default)]
    pub trigger: String,
}

fn default_poll_interval() -> u64 {
    900
}
fn default_status() -> RootStatus {
    RootStatus::Unknown
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Model,
    Image,
    Document,
    Attachment,
    Other,
}

impl FileKind {
    pub fn from_extension(ext: &str) -> FileKind {
        match ext.to_ascii_lowercase().as_str() {
            "stl" | "obj" | "3mf" | "ply" | "amf" | "step" | "stp" => FileKind::Model,
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => FileKind::Image,
            "pdf" | "txt" | "md" | "scad" | "f3d" | "blend" | "readme" => FileKind::Document,
            "zip" | "7z" | "rar" | "tar" | "gz" => FileKind::Attachment,
            _ => FileKind::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Path relative to the project directory, forward slashes.
    pub rel_path: String,
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub modified: OffsetDateTime,
    /// For 3MF files written by a slicer: which one (e.g. "PrusaSlicer", "Bambu Studio / OrcaSlicer").
    #[serde(default)]
    pub slicer: Option<String>,
    /// 3MF with an embedded preview image (used as the thumbnail without rendering).
    #[serde(default)]
    pub embedded_thumbnail: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "message", rename_all = "snake_case")]
pub enum SidecarState {
    /// No project.yaml yet (metadata is derived from the directory).
    Missing,
    /// Parsed fine.
    Ok,
    /// File exists but could not be parsed; the message explains why.
    Malformed(String),
}

/// `project.yaml`. Unknown keys are preserved on write via the `extra` maps.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Sidecar {
    #[serde(default = "default_schema")]
    pub schema: u32,
    #[serde(default)]
    pub metadata: Metadata,
    #[serde(default, skip_serializing_if = "Printing::is_empty")]
    pub printing: Printing,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<SidecarFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

fn default_schema() -> u32 {
    1
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Printing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_material: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

impl Printing {
    pub fn is_empty(&self) -> bool {
        self.recommended_material.is_none() && self.supports_required.is_none() && self.notes.is_none() && self.extra.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SidecarFile {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity: Option<u32>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

/// Opaque stamp identifying a sidecar version on disk (mtime + size). Returned with a
/// project and handed back on save so an external edit in between is detected. The mtime
/// travels as a string: as a JSON number it exceeds JavaScript's 2^53 and came back rounded,
/// so every second save of a project reported a conflict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SidecarStamp {
    #[serde(with = "i128_as_string")]
    pub mtime_unix_nanos: i128,
    pub size: u64,
}

mod i128_as_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &i128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i128, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Str(String),
            Num(i128),
            Float(f64),
        }
        match Raw::deserialize(d)? {
            Raw::Str(s) => s.parse().map_err(serde::de::Error::custom),
            Raw::Num(n) => Ok(n),
            Raw::Float(f) => Ok(f as i128),
        }
    }
}

#[cfg(test)]
mod stamp_tests {
    use super::SidecarStamp;

    #[test]
    fn stamp_survives_json_exactly() {
        // a Windows mtime in nanoseconds has more bits than a JavaScript number keeps
        let stamp = SidecarStamp {
            mtime_unix_nanos: 1_760_950_123_456_789_123,
            size: 321,
        };
        let json = serde_json::to_string(&stamp).unwrap();
        assert!(json.contains("\"1760950123456789123\""), "{json}");
        let back: SidecarStamp = serde_json::from_str(&json).unwrap();
        assert_eq!(back, stamp);
        let old: SidecarStamp = serde_json::from_str("{\"mtime_unix_nanos\":12345,\"size\":1}").unwrap();
        assert_eq!(old.mtime_unix_nanos, 12345);
    }
}

/// A project as the UI sees it: derived data plus whatever the sidecar says.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// `{root_id}:{rel_path}`; stable as long as the directory is not renamed.
    pub id: String,
    pub root_id: String,
    /// Directory relative to the root, forward slashes, empty for the root itself.
    pub rel_path: String,
    pub title: String,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub material: Option<String>,
    pub supports_required: Option<bool>,
    pub thumbnail: Option<String>,
    pub files: Vec<FileEntry>,
    pub total_bytes: u64,
    pub model_count: u32,
    #[serde(with = "time::serde::rfc3339")]
    pub modified: OffsetDateTime,
    pub sidecar: SidecarState,
    /// Present when read through `Engine::get_project`; pass back on save.
    #[serde(default)]
    pub sidecar_stamp: Option<SidecarStamp>,
    /// Non-fatal findings from the scanner, e.g. a nested project.yaml.
    pub warnings: Vec<String>,
    pub offline: bool,
    /// User favorite (stored in `collections.json`, not in the sidecar).
    #[serde(default)]
    pub favorite: bool,
    /// When the project directory appeared on disk (creation time, falling back to modified).
    #[serde(default = "epoch", with = "time::serde::rfc3339")]
    pub added: OffsetDateTime,
    /// Cache key of the rendered/extracted thumbnail, `None` until generated or when stale.
    #[serde(default)]
    pub thumb: Option<String>,
    /// Slicer badge, derived from the first slicer-written 3MF in the project.
    #[serde(default)]
    pub slicer: Option<String>,
}

pub(crate) fn epoch() -> OffsetDateTime {
    OffsetDateTime::UNIX_EPOCH
}

/// Where a project's thumbnail comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbSource {
    /// Render the model file in `rel_path` (STL, OBJ, 3MF).
    Render,
    /// Use the image file in `rel_path` (sidecar `thumbnail:` or the project's own photo).
    Image,
    /// Extract the preview embedded in the 3MF in `rel_path`; no rendering needed.
    Embedded,
}

/// One pending thumbnail. The shell/frontend renders `Render` and `Image` jobs; the engine
/// handles `Embedded` on its own (`Engine::store_embedded_thumbnail`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbJob {
    pub project_id: String,
    pub rel_path: String,
    pub source: ThumbSource,
}

/// Rough shape of the thumbnail backlog for the status bar.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ThumbStats {
    pub pending: u32,
    pub done: u32,
    pub failed: u32,
}

impl Project {
    pub fn make_id(root_id: &str, rel_path: &str) -> String {
        format!("{root_id}:{rel_path}")
    }
    pub fn split_id(id: &str) -> Option<(&str, &str)> {
        id.split_once(':')
    }
}

/// A lightweight row for lists and grids.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub root_id: String,
    pub rel_path: String,
    pub title: String,
    pub creator: Option<String>,
    pub tags: Vec<String>,
    pub thumbnail: Option<String>,
    pub file_count: u32,
    pub model_count: u32,
    pub total_bytes: u64,
    #[serde(with = "time::serde::rfc3339")]
    pub modified: OffsetDateTime,
    pub has_sidecar: bool,
    pub offline: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default = "epoch", with = "time::serde::rfc3339")]
    pub added: OffsetDateTime,
    #[serde(default)]
    pub thumb: Option<String>,
    #[serde(default)]
    pub slicer: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub root_id: Option<String>,
    /// Only projects at or below this folder (relative to the root).
    #[serde(default)]
    pub path_prefix: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Full-text search over title, creator, description, tags, file names.
    #[serde(default)]
    pub text: Option<String>,
    /// Only favorites.
    #[serde(default)]
    pub favorites: bool,
    /// Only members of this manual collection (in collection order unless sorted otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<String>,
    /// Exact creator name, case-insensitive (NAV-5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    /// Exact license string, case-insensitive (NAV-5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    /// Recommended material, case-insensitive (NAV-5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// Projects containing at least one model file with this extension (lowercase, no dot).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(default)]
    pub sort: SortKey,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    #[default]
    Modified,
    Title,
    Creator,
    Size,
    /// Newest additions first (directory creation time).
    Added,
    /// The manual order of the collection being listed (falls back to `Modified`).
    Collection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}

/// One value of an attribute filter with the number of projects carrying it (NAV-5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FacetCount {
    pub value: String,
    pub count: u32,
}

/// Attribute filters derived from the indexed data, optionally scoped to one root.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Facets {
    pub creators: Vec<FacetCount>,
    pub licenses: Vec<FacetCount>,
    pub materials: Vec<FacetCount>,
    /// Model file extensions (`stl`, `3mf`, ...), counted per project.
    pub file_types: Vec<FacetCount>,
}

/// Where rendered previews are stored (Q5, APP-4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbLocation {
    /// `<app data>/thumbs/<key>.png`: nothing is written into a library (default).
    #[default]
    AppData,
    /// `<project>/.cache/thumbs/<key>.png`: previews travel with the project.
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderNode {
    pub name: String,
    pub rel_path: String,
    pub project_count: u32,
    pub children: Vec<FolderNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub root_id: String,
    pub projects: u32,
    pub files: u32,
    pub ignored: u32,
    pub warnings: Vec<String>,
    pub millis: u128,
}
