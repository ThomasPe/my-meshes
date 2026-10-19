//! SQLite cache of everything the scanner found, with FTS5 search. Disposable by design:
//! `Index::rebuild_root` replaces a root's rows wholesale from a scan, and a schema bump
//! drops and recreates everything (the next scan refills it).
//!
//! The one table that is *not* rebuilt from a scan is `thumbs`: it remembers which cached
//! PNG belongs to which project and from which source file state it was made.

use crate::error::Result;
use crate::model::{
    FacetCount, Facets, FileEntry, FileKind, FolderNode, ListQuery, Project, ProjectSummary, SidecarState, SortKey, TagCount, ThumbJob,
    ThumbSource, ThumbStats,
};
use crate::thumbs;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::Path;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub struct Index {
    conn: Connection,
}

const SCHEMA_VERSION: i64 = 3;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, root_id TEXT NOT NULL, rel_path TEXT NOT NULL, title TEXT NOT NULL,
  creator TEXT, license TEXT, source_url TEXT, description TEXT, material TEXT, supports_required INTEGER,
  thumbnail TEXT, total_bytes INTEGER NOT NULL, file_count INTEGER NOT NULL, model_count INTEGER NOT NULL,
  modified TEXT NOT NULL, added TEXT NOT NULL, sidecar_state TEXT NOT NULL, sidecar_message TEXT, warnings TEXT NOT NULL,
  offline INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, slicer TEXT,
  thumb_source TEXT, thumb_kind TEXT
);
CREATE INDEX IF NOT EXISTS projects_root ON projects(root_id, rel_path);
CREATE INDEX IF NOT EXISTS projects_added ON projects(added);
CREATE TABLE IF NOT EXISTS files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, modified TEXT NOT NULL,
  slicer TEXT, embedded_thumbnail INTEGER NOT NULL DEFAULT 0, ext TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, rel_path)
);
CREATE INDEX IF NOT EXISTS files_ext ON files(ext);
CREATE TABLE IF NOT EXISTS tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (project_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(id UNINDEXED, title, creator, description, tags, filenames, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS thumbs (
  project_id TEXT PRIMARY KEY, source_rel TEXT NOT NULL, source_size INTEGER NOT NULL, source_mtime TEXT NOT NULL,
  key TEXT, error TEXT, updated TEXT NOT NULL
);
"#;

const DROP: &str = r#"
DROP TABLE IF EXISTS projects_fts; DROP TABLE IF EXISTS tags; DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS thumbs; DROP TABLE IF EXISTS meta;
"#;

/// The thumbnail is current when its source file still has the recorded size and mtime.
const THUMB_JOIN: &str =
    " LEFT JOIN thumbs t ON t.project_id = p.id LEFT JOIN files sf ON sf.project_id = p.id AND sf.rel_path = p.thumb_source";
const THUMB_VALID: &str = "(t.source_rel = p.thumb_source AND sf.size = t.source_size AND sf.modified = t.source_mtime)";

fn ts(t: &OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}
fn parse_ts(s: &str) -> OffsetDateTime {
    OffsetDateTime::parse(s, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}
fn ext_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}
fn kind_str(k: FileKind) -> &'static str {
    match k {
        FileKind::Model => "model",
        FileKind::Image => "image",
        FileKind::Document => "document",
        FileKind::Attachment => "attachment",
        FileKind::Other => "other",
    }
}
fn kind_parse(s: &str) -> FileKind {
    match s {
        "model" => FileKind::Model,
        "image" => FileKind::Image,
        "document" => FileKind::Document,
        "attachment" => FileKind::Attachment,
        _ => FileKind::Other,
    }
}
fn thumb_kind_str(k: ThumbSource) -> &'static str {
    match k {
        ThumbSource::Render => "render",
        ThumbSource::Image => "image",
        ThumbSource::Embedded => "embedded",
    }
}
fn thumb_kind_parse(s: &str) -> ThumbSource {
    match s {
        "image" => ThumbSource::Image,
        "embedded" => ThumbSource::Embedded,
        _ => ThumbSource::Render,
    }
}

/// Source file state a thumbnail was (or would be) made from.
#[derive(Debug, Clone)]
pub struct ThumbSourceState {
    pub rel_path: String,
    pub source: ThumbSource,
    pub size: u64,
    pub modified: String,
}

impl Index {
    pub fn open(path: &Path) -> Result<Index> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }
    pub fn open_in_memory() -> Result<Index> {
        Self::init(Connection::open_in_memory()?)
    }
    fn init(conn: Connection) -> Result<Index> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version == 2 {
            // v2 -> v3 adds files.ext; migrate in place so cached thumbnails survive.
            conn.execute_batch("ALTER TABLE files ADD COLUMN ext TEXT NOT NULL DEFAULT '';")?;
            let rows: Vec<(String, String, String)> = conn
                .prepare("SELECT project_id, rel_path, name FROM files")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (pid, rel, name) in rows {
                conn.execute(
                    "UPDATE files SET ext = ?3 WHERE project_id = ?1 AND rel_path = ?2",
                    params![pid, rel, ext_of(&name)],
                )?;
            }
        } else if version != SCHEMA_VERSION {
            conn.execute_batch(DROP)?;
        }
        conn.execute_batch(SCHEMA)?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        Ok(Index { conn })
    }

    /// Replaces all rows of a root with the given projects, in one transaction.
    pub fn rebuild_root(&mut self, root_id: &str, projects: &[Project]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM projects_fts WHERE id IN (SELECT id FROM projects WHERE root_id = ?1)",
            params![root_id],
        )?;
        tx.execute("DELETE FROM projects WHERE root_id = ?1", params![root_id])?;
        for p in projects {
            Self::insert_project(&tx, p)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Inserts or replaces a single project (after a watcher event or a metadata edit).
    pub fn upsert_project(&mut self, p: &Project) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM projects_fts WHERE id = ?1", params![p.id])?;
        tx.execute("DELETE FROM projects WHERE id = ?1", params![p.id])?;
        Self::insert_project(&tx, p)?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_project(&mut self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM projects_fts WHERE id = ?1", params![id])?;
        self.conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        self.conn.execute("DELETE FROM thumbs WHERE project_id = ?1", params![id])?;
        Ok(())
    }

    fn insert_project(tx: &rusqlite::Transaction, p: &Project) -> Result<()> {
        let (state, msg) = match &p.sidecar {
            SidecarState::Missing => ("missing", None),
            SidecarState::Ok => ("ok", None),
            SidecarState::Malformed(m) => ("malformed", Some(m.as_str())),
        };
        let thumb = thumbs::choose_source(&p.files, p.thumbnail.as_deref());
        tx.execute(
            "INSERT INTO projects (id, root_id, rel_path, title, creator, license, source_url, description, material, supports_required, thumbnail, total_bytes, file_count, model_count, modified, added, sidecar_state, sidecar_message, warnings, offline, favorite, slicer, thumb_source, thumb_kind)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)",
            params![
                p.id,
                p.root_id,
                p.rel_path,
                p.title,
                p.creator,
                p.license,
                p.source_url,
                p.description,
                p.material,
                p.supports_required.map(|b| b as i32),
                p.thumbnail,
                p.total_bytes as i64,
                p.files.len() as i64,
                p.model_count as i64,
                ts(&p.modified),
                ts(&p.added),
                state,
                msg,
                serde_json::to_string(&p.warnings).unwrap_or_default(),
                p.offline as i32,
                p.favorite as i32,
                p.slicer,
                thumb.as_ref().map(|(rel, _)| rel.clone()),
                thumb.as_ref().map(|(_, k)| thumb_kind_str(*k)),
            ],
        )?;
        let mut fs_stmt = tx.prepare_cached(
            "INSERT INTO files (project_id, rel_path, name, kind, size, modified, slicer, embedded_thumbnail, ext) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )?;
        for f in &p.files {
            fs_stmt.execute(params![
                p.id,
                f.rel_path,
                f.name,
                kind_str(f.kind),
                f.size as i64,
                ts(&f.modified),
                f.slicer,
                f.embedded_thumbnail as i32,
                ext_of(&f.name)
            ])?;
        }
        let mut tag_stmt = tx.prepare_cached("INSERT OR IGNORE INTO tags (project_id, tag) VALUES (?1, ?2)")?;
        for t in &p.tags {
            tag_stmt.execute(params![p.id, t.to_lowercase()])?;
        }
        tx.execute(
            "INSERT INTO projects_fts (id, title, creator, description, tags, filenames) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                p.id,
                p.title,
                p.creator,
                p.description,
                p.tags.join(" "),
                p.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>().join(" ")
            ],
        )?;
        Ok(())
    }

    pub fn mark_root_offline(&mut self, root_id: &str, offline: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE projects SET offline = ?2 WHERE root_id = ?1",
            params![root_id, offline as i32],
        )?;
        Ok(())
    }

    pub fn remove_root(&mut self, root_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM projects_fts WHERE id IN (SELECT id FROM projects WHERE root_id = ?1)",
            params![root_id],
        )?;
        self.conn.execute(
            "DELETE FROM thumbs WHERE project_id IN (SELECT id FROM projects WHERE root_id = ?1)",
            params![root_id],
        )?;
        self.conn.execute("DELETE FROM projects WHERE root_id = ?1", params![root_id])?;
        Ok(())
    }

    pub fn set_favorite(&mut self, id: &str, favorite: bool) -> Result<bool> {
        let n = self
            .conn
            .execute("UPDATE projects SET favorite = ?2 WHERE id = ?1", params![id, favorite as i32])?;
        Ok(n > 0)
    }

    pub fn project(&self, id: &str) -> Result<Option<Project>> {
        let sql = format!(
            "SELECT p.id, p.root_id, p.rel_path, p.title, p.creator, p.license, p.source_url, p.description, p.material, p.supports_required, p.thumbnail, p.total_bytes, p.model_count, p.modified, p.sidecar_state, p.sidecar_message, p.warnings, p.offline, p.favorite, p.added, p.slicer, CASE WHEN {THUMB_VALID} THEN t.key END FROM projects p{THUMB_JOIN} WHERE p.id = ?1"
        );
        let row = self
            .conn
            .query_row(&sql, params![id], |r| {
                let state: String = r.get(14)?;
                let msg: Option<String> = r.get(15)?;
                let warnings: String = r.get(16)?;
                Ok(Project {
                    id: r.get(0)?,
                    root_id: r.get(1)?,
                    rel_path: r.get(2)?,
                    title: r.get(3)?,
                    creator: r.get(4)?,
                    license: r.get(5)?,
                    source_url: r.get(6)?,
                    description: r.get(7)?,
                    tags: Vec::new(),
                    material: r.get(8)?,
                    supports_required: r.get::<_, Option<i32>>(9)?.map(|v| v != 0),
                    thumbnail: r.get(10)?,
                    files: Vec::new(),
                    total_bytes: r.get::<_, i64>(11)? as u64,
                    model_count: r.get::<_, i64>(12)? as u32,
                    modified: parse_ts(&r.get::<_, String>(13)?),
                    sidecar: match state.as_str() {
                        "ok" => SidecarState::Ok,
                        "malformed" => SidecarState::Malformed(msg.unwrap_or_default()),
                        _ => SidecarState::Missing,
                    },
                    sidecar_stamp: None,
                    warnings: serde_json::from_str(&warnings).unwrap_or_default(),
                    offline: r.get::<_, i32>(17)? != 0,
                    favorite: r.get::<_, i32>(18)? != 0,
                    added: parse_ts(&r.get::<_, String>(19)?),
                    slicer: r.get(20)?,
                    thumb: r.get(21)?,
                })
            })
            .optional()?;
        let Some(mut p) = row else { return Ok(None) };
        p.tags = self.tags_of(id)?;
        let mut st = self.conn.prepare_cached(
            "SELECT rel_path, name, kind, size, modified, slicer, embedded_thumbnail FROM files WHERE project_id = ?1 ORDER BY rel_path",
        )?;
        p.files = st
            .query_map(params![id], |r| {
                Ok(FileEntry {
                    rel_path: r.get(0)?,
                    name: r.get(1)?,
                    kind: kind_parse(&r.get::<_, String>(2)?),
                    size: r.get::<_, i64>(3)? as u64,
                    modified: parse_ts(&r.get::<_, String>(4)?),
                    slicer: r.get(5)?,
                    embedded_thumbnail: r.get::<_, i32>(6)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Some(p))
    }

    fn tags_of(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self
            .conn
            .prepare_cached("SELECT tag FROM tags WHERE project_id = ?1 ORDER BY tag")?;
        let tags = st
            .query_map(params![id], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    /// `collection`: member ids in collection order when the query is scoped to a collection.
    pub fn list(&self, q: &ListQuery, collection: Option<&[String]>) -> Result<Vec<ProjectSummary>> {
        let mut sql = format!("SELECT p.id, p.root_id, p.rel_path, p.title, p.creator, p.thumbnail, p.file_count, p.model_count, p.total_bytes, p.modified, p.sidecar_state, p.offline, p.favorite, p.added, p.slicer, CASE WHEN {THUMB_VALID} THEN t.key END FROM projects p{THUMB_JOIN}");
        let mut where_: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = q.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            // prefix match on every term, so typing feels instant
            let fts = text
                .split_whitespace()
                .map(|t| format!("\"{}\"*", t.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" ");
            sql.push_str(" JOIN projects_fts f ON f.id = p.id");
            where_.push("projects_fts MATCH ?".into());
            args.push(Box::new(fts));
        }
        if let Some(root) = &q.root_id {
            where_.push("p.root_id = ?".into());
            args.push(Box::new(root.clone()));
        }
        if let Some(prefix) = q.path_prefix.as_deref().filter(|p| !p.is_empty()) {
            where_.push("(p.rel_path = ? OR p.rel_path LIKE ? ESCAPE '\\')".into());
            args.push(Box::new(prefix.to_string()));
            args.push(Box::new(format!(
                "{}/%",
                prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
            )));
        }
        for tag in &q.tags {
            where_.push("EXISTS (SELECT 1 FROM tags t2 WHERE t2.project_id = p.id AND t2.tag = ?)".into());
            args.push(Box::new(tag.to_lowercase()));
        }
        if q.favorites {
            where_.push("p.favorite = 1".into());
        }
        if let Some(c) = q.creator.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            where_.push("p.creator = ? COLLATE NOCASE".into());
            args.push(Box::new(c.to_string()));
        }
        if let Some(l) = q.license.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            where_.push("p.license = ? COLLATE NOCASE".into());
            args.push(Box::new(l.to_string()));
        }
        if let Some(m) = q.material.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            where_.push("p.material = ? COLLATE NOCASE".into());
            args.push(Box::new(m.to_string()));
        }
        if let Some(e) = q
            .file_type
            .as_deref()
            .map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase())
            .filter(|e| !e.is_empty())
        {
            where_.push("EXISTS (SELECT 1 FROM files fx WHERE fx.project_id = p.id AND fx.kind = 'model' AND fx.ext = ?)".into());
            args.push(Box::new(e));
        }
        if let Some(ids) = &collection {
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            where_.push(format!("p.id IN ({})", vec!["?"; ids.len()].join(",")));
            for id in ids.iter() {
                args.push(Box::new(id.clone()));
            }
        }
        if !where_.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&where_.join(" AND "));
        }
        sql.push_str(match q.sort {
            SortKey::Modified => " ORDER BY p.modified DESC, p.title COLLATE NOCASE",
            SortKey::Title => " ORDER BY p.title COLLATE NOCASE",
            SortKey::Creator => " ORDER BY p.creator IS NULL, p.creator COLLATE NOCASE, p.title COLLATE NOCASE",
            SortKey::Size => " ORDER BY p.total_bytes DESC",
            SortKey::Added => " ORDER BY p.added DESC, p.modified DESC, p.title COLLATE NOCASE",
            SortKey::Collection => " ORDER BY p.modified DESC, p.title COLLATE NOCASE",
        });
        if let Some(limit) = q.limit {
            sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, q.offset.unwrap_or(0)));
        }
        let mut st = self.conn.prepare(&sql)?;
        let rows = st
            .query_map(rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())), |r| {
                Ok(ProjectSummary {
                    id: r.get(0)?,
                    root_id: r.get(1)?,
                    rel_path: r.get(2)?,
                    title: r.get(3)?,
                    creator: r.get(4)?,
                    tags: Vec::new(),
                    thumbnail: r.get(5)?,
                    file_count: r.get::<_, i64>(6)? as u32,
                    model_count: r.get::<_, i64>(7)? as u32,
                    total_bytes: r.get::<_, i64>(8)? as u64,
                    modified: parse_ts(&r.get::<_, String>(9)?),
                    has_sidecar: r.get::<_, String>(10)? == "ok",
                    offline: r.get::<_, i32>(11)? != 0,
                    favorite: r.get::<_, i32>(12)? != 0,
                    added: parse_ts(&r.get::<_, String>(13)?),
                    slicer: r.get(14)?,
                    thumb: r.get(15)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = rows;
        for p in &mut out {
            p.tags = self.tags_of(&p.id)?;
        }
        if q.sort == SortKey::Collection {
            if let Some(ids) = collection {
                out.sort_by_key(|p| ids.iter().position(|i| i == &p.id).unwrap_or(usize::MAX));
            }
        }
        Ok(out)
    }

    pub fn tag_counts(&self, root_id: Option<&str>) -> Result<Vec<TagCount>> {
        let mut st = self.conn.prepare(
            "SELECT t.tag, COUNT(*) FROM tags t JOIN projects p ON p.id = t.project_id WHERE (?1 IS NULL OR p.root_id = ?1) GROUP BY t.tag ORDER BY COUNT(*) DESC, t.tag",
        )?;
        let rows = st
            .query_map(params![root_id], |r| {
                Ok(TagCount {
                    tag: r.get(0)?,
                    count: r.get::<_, i64>(1)? as u32,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Attribute filter values with counts (NAV-5), most frequent first.
    pub fn facets(&self, root_id: Option<&str>) -> Result<Facets> {
        let column = |col: &str| -> Result<Vec<FacetCount>> {
            let mut st = self.conn.prepare(&format!(
                "SELECT p.{col}, COUNT(*) FROM projects p WHERE p.{col} IS NOT NULL AND p.{col} != '' AND (?1 IS NULL OR p.root_id = ?1) GROUP BY p.{col} COLLATE NOCASE ORDER BY COUNT(*) DESC, p.{col} COLLATE NOCASE"
            ))?;
            let rows = st
                .query_map(params![root_id], |r| {
                    Ok(FacetCount {
                        value: r.get(0)?,
                        count: r.get::<_, i64>(1)? as u32,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(rows)
        };
        let mut st = self.conn.prepare(
            "SELECT f.ext, COUNT(DISTINCT f.project_id) FROM files f JOIN projects p ON p.id = f.project_id WHERE f.kind = 'model' AND f.ext != '' AND (?1 IS NULL OR p.root_id = ?1) GROUP BY f.ext ORDER BY COUNT(DISTINCT f.project_id) DESC, f.ext",
        )?;
        let file_types = st
            .query_map(params![root_id], |r| {
                Ok(FacetCount {
                    value: r.get(0)?,
                    count: r.get::<_, i64>(1)? as u32,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Facets {
            creators: column("creator")?,
            licenses: column("license")?,
            materials: column("material")?,
            file_types,
        })
    }

    pub fn count(&self, root_id: Option<&str>) -> Result<(u32, u64)> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_bytes),0) FROM projects WHERE (?1 IS NULL OR root_id = ?1)",
            params![root_id],
            |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, i64>(1)? as u64)),
        )?)
    }

    pub fn favorite_count(&self) -> Result<u32> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM projects WHERE favorite = 1", [], |r| r.get::<_, i64>(0))? as u32)
    }

    /// Folder tree of one root, derived from project paths (every ancestor directory appears).
    pub fn folder_tree(&self, root_id: &str) -> Result<Vec<FolderNode>> {
        let mut st = self.conn.prepare("SELECT rel_path FROM projects WHERE root_id = ?1")?;
        let paths: Vec<String> = st
            .query_map(params![root_id], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        #[derive(Default)]
        struct Node {
            count: u32,
            children: BTreeMap<String, Node>,
        }
        let mut root = Node::default();
        for p in &paths {
            let mut cur = &mut root;
            cur.count += 1;
            if p.is_empty() {
                continue;
            }
            for seg in p.split('/') {
                cur = cur.children.entry(seg.to_string()).or_default();
                cur.count += 1;
            }
        }
        fn build(prefix: &str, n: &Node) -> Vec<FolderNode> {
            n.children
                .iter()
                .map(|(name, child)| {
                    let rel = if prefix.is_empty() {
                        name.clone()
                    } else {
                        format!("{prefix}/{name}")
                    };
                    FolderNode {
                        name: name.clone(),
                        rel_path: rel.clone(),
                        project_count: child.count,
                        children: build(&rel, child),
                    }
                })
                .collect()
        }
        Ok(build("", &root))
    }

    // ---- thumbnails -------------------------------------------------------------------

    /// Projects that need a thumbnail: online, with a source, and no current PNG or error
    /// for that exact source state. Newest first, so the visible top of the library fills in.
    pub fn thumb_queue(&self, limit: u32) -> Result<Vec<ThumbJob>> {
        let sql = format!(
            "SELECT p.id, p.thumb_source, p.thumb_kind FROM projects p{THUMB_JOIN} WHERE p.offline = 0 AND p.thumb_source IS NOT NULL AND sf.rel_path IS NOT NULL AND NOT COALESCE({THUMB_VALID}, 0) ORDER BY p.added DESC, p.modified DESC LIMIT ?1"
        );
        let mut st = self.conn.prepare(&sql)?;
        let rows = st
            .query_map(params![limit], |r| {
                Ok(ThumbJob {
                    project_id: r.get(0)?,
                    rel_path: r.get(1)?,
                    source: thumb_kind_parse(&r.get::<_, String>(2)?),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn thumb_stats(&self) -> Result<ThumbStats> {
        let sql = format!(
            "SELECT
               SUM(CASE WHEN {THUMB_VALID} AND t.key IS NOT NULL THEN 1 ELSE 0 END),
               SUM(CASE WHEN {THUMB_VALID} AND t.key IS NULL THEN 1 ELSE 0 END),
               SUM(CASE WHEN NOT COALESCE({THUMB_VALID}, 0) THEN 1 ELSE 0 END)
             FROM projects p{THUMB_JOIN} WHERE p.offline = 0 AND p.thumb_source IS NOT NULL AND sf.rel_path IS NOT NULL"
        );
        Ok(self.conn.query_row(&sql, [], |r| {
            Ok(ThumbStats {
                done: r.get::<_, Option<i64>>(0)?.unwrap_or(0) as u32,
                failed: r.get::<_, Option<i64>>(1)?.unwrap_or(0) as u32,
                pending: r.get::<_, Option<i64>>(2)?.unwrap_or(0) as u32,
            })
        })?)
    }

    /// Current source file state for a project's thumbnail, if it has a source.
    pub fn thumb_source(&self, project_id: &str) -> Result<Option<ThumbSourceState>> {
        Ok(self
            .conn
            .query_row(
                "SELECT p.thumb_source, p.thumb_kind, sf.size, sf.modified FROM projects p JOIN files sf ON sf.project_id = p.id AND sf.rel_path = p.thumb_source WHERE p.id = ?1",
                params![project_id],
                |r| {
                    Ok(ThumbSourceState {
                        rel_path: r.get(0)?,
                        source: thumb_kind_parse(&r.get::<_, String>(1)?),
                        size: r.get::<_, i64>(2)? as u64,
                        modified: r.get(3)?,
                    })
                },
            )
            .optional()?)
    }

    /// Records a finished (key) or failed (error) thumbnail for the given source state.
    pub fn set_thumb(&mut self, project_id: &str, src: &ThumbSourceState, key: Option<&str>, error: Option<&str>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO thumbs (project_id, source_rel, source_size, source_mtime, key, error, updated) VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(project_id) DO UPDATE SET source_rel=excluded.source_rel, source_size=excluded.source_size, source_mtime=excluded.source_mtime, key=excluded.key, error=excluded.error, updated=excluded.updated",
            params![project_id, src.rel_path, src.size as i64, src.modified, key, error, ts(&OffsetDateTime::now_utc())],
        )?;
        Ok(())
    }

    /// The project a cached thumbnail belongs to (for `ThumbLocation::Project` lookups).
    pub fn project_of_thumb(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT project_id FROM thumbs WHERE key = ?1", params![key], |r| r.get(0))
            .optional()?)
    }

    /// Every stored (project, key) pair, for cache maintenance.
    pub fn thumb_keys(&self) -> Result<Vec<(String, String)>> {
        let mut st = self.conn.prepare("SELECT project_id, key FROM thumbs WHERE key IS NOT NULL")?;
        let rows = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn rename_thumb(&mut self, old_id: &str, new_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM thumbs WHERE project_id = ?1", params![new_id])?;
        self.conn
            .execute("UPDATE thumbs SET project_id = ?2 WHERE project_id = ?1", params![old_id, new_id])?;
        Ok(())
    }

    /// Clears every thumbnail record (the PNG files are removed by the engine).
    pub fn clear_thumbs(&mut self) -> Result<()> {
        self.conn.execute("DELETE FROM thumbs", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FileKind;

    fn proj(id: &str, rel: &str, title: &str, tags: &[&str], files: &[&str]) -> Project {
        Project {
            id: Project::make_id("r1", rel),
            root_id: "r1".into(),
            rel_path: rel.into(),
            title: title.into(),
            creator: Some(format!("creator of {id}")),
            license: None,
            source_url: None,
            description: Some("desc".into()),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            material: None,
            supports_required: None,
            thumbnail: None,
            files: files
                .iter()
                .enumerate()
                .map(|(i, f)| FileEntry {
                    rel_path: f.to_string(),
                    name: f.to_string(),
                    kind: FileKind::from_extension(f.rsplit('.').next().unwrap()),
                    size: 10 + i as u64,
                    modified: OffsetDateTime::UNIX_EPOCH,
                    slicer: None,
                    embedded_thumbnail: false,
                })
                .collect(),
            total_bytes: 10 * files.len() as u64,
            model_count: files.iter().filter(|f| f.ends_with(".stl")).count() as u32,
            modified: OffsetDateTime::UNIX_EPOCH,
            sidecar: SidecarState::Missing,
            sidecar_stamp: None,
            warnings: vec![],
            offline: false,
            favorite: false,
            added: OffsetDateTime::UNIX_EPOCH,
            thumb: None,
            slicer: None,
        }
    }

    #[test]
    fn rebuild_list_search_and_tree() {
        let mut ix = Index::open_in_memory().unwrap();
        ix.rebuild_root(
            "r1",
            &[
                proj(
                    "a",
                    "Gridfinity/Bins",
                    "Gridfinity Bins",
                    &["gridfinity", "organizer"],
                    &["bin_1x1.stl"],
                ),
                proj("b", "Gridfinity/Lids", "Lids", &["gridfinity"], &["lid.stl"]),
                proj("c", "Robotics/Arm", "Robotic Arm v4", &["robotics"], &["base.stl", "bom.pdf"]),
            ],
        )
        .unwrap();
        assert_eq!(ix.count(None).unwrap().0, 3);
        let all = ix.list(&ListQuery::default(), None).unwrap();
        assert_eq!(all.len(), 3);
        let grid = ix
            .list(
                &ListQuery {
                    tags: vec!["gridfinity".into()],
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(grid.len(), 2);
        let search = ix
            .list(
                &ListQuery {
                    text: Some("robo".into()),
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].title, "Robotic Arm v4");
        let by_file = ix
            .list(
                &ListQuery {
                    text: Some("bom".into()),
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(by_file.len(), 1);
        let under = ix
            .list(
                &ListQuery {
                    path_prefix: Some("Gridfinity".into()),
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(under.len(), 2);
        let tree = ix.folder_tree("r1").unwrap();
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0].name, "Gridfinity");
        assert_eq!(tree[0].project_count, 2);
        assert_eq!(tree[0].children.len(), 2);
        let tags = ix.tag_counts(None).unwrap();
        assert_eq!(tags[0].tag, "gridfinity");
        assert_eq!(tags[0].count, 2);
        let full = ix.project(&Project::make_id("r1", "Robotics/Arm")).unwrap().unwrap();
        assert_eq!(full.files.len(), 2);
        assert_eq!(full.tags, vec!["robotics"]);
        // favorites
        assert!(ix.set_favorite(&full.id, true).unwrap());
        let favs = ix
            .list(
                &ListQuery {
                    favorites: true,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(favs.len(), 1);
        assert!(favs[0].favorite);
        assert_eq!(ix.favorite_count().unwrap(), 1);
        // rebuild replaces
        ix.rebuild_root("r1", &[proj("a", "Gridfinity/Bins", "Bins", &[], &["bin.stl"])])
            .unwrap();
        assert_eq!(ix.count(None).unwrap().0, 1);
        ix.mark_root_offline("r1", true).unwrap();
        assert!(ix.list(&ListQuery::default(), None).unwrap()[0].offline);
    }

    #[test]
    fn thumbnail_queue_tracks_source_state() {
        let mut ix = Index::open_in_memory().unwrap();
        let a = proj("a", "A", "A", &[], &["small.stl", "big.stl"]);
        let b = proj("b", "B", "B", &[], &["notes.txt"]);
        ix.rebuild_root("r1", &[a.clone(), b]).unwrap();
        let q = ix.thumb_queue(10).unwrap();
        assert_eq!(q.len(), 1, "{q:?}");
        assert_eq!(q[0].rel_path, "big.stl");
        assert_eq!(q[0].source, ThumbSource::Render);
        assert_eq!(ix.thumb_stats().unwrap().pending, 1);

        let src = ix.thumb_source(&a.id).unwrap().unwrap();
        ix.set_thumb(&a.id, &src, Some("k.png"), None).unwrap();
        assert!(ix.thumb_queue(10).unwrap().is_empty());
        assert_eq!(
            ix.list(&ListQuery::default(), None)
                .unwrap()
                .iter()
                .find(|p| p.id == a.id)
                .unwrap()
                .thumb
                .as_deref(),
            Some("k.png")
        );
        assert_eq!(ix.thumb_stats().unwrap().done, 1);

        // the source file changes -> stale -> queued again, thumb hidden
        let mut a2 = a.clone();
        a2.files[1].size = 999;
        ix.upsert_project(&a2).unwrap();
        assert_eq!(ix.thumb_queue(10).unwrap().len(), 1);
        assert!(ix.project(&a.id).unwrap().unwrap().thumb.is_none());

        // a failure for the current state is not retried
        let src2 = ix.thumb_source(&a.id).unwrap().unwrap();
        ix.set_thumb(&a.id, &src2, None, Some("no webgl")).unwrap();
        assert!(ix.thumb_queue(10).unwrap().is_empty());
        assert_eq!(ix.thumb_stats().unwrap().failed, 1);

        // offline projects are not queued
        let mut a3 = a2.clone();
        a3.files[1].size = 1000;
        ix.upsert_project(&a3).unwrap();
        ix.mark_root_offline("r1", true).unwrap();
        assert!(ix.thumb_queue(10).unwrap().is_empty());

        // rename carries the record over
        ix.rename_thumb(&a.id, "r1:A2").unwrap();
        ix.remove_project(&a.id).unwrap();
    }

    #[test]
    fn collection_scope_keeps_manual_order() {
        let mut ix = Index::open_in_memory().unwrap();
        ix.rebuild_root(
            "r1",
            &[
                proj("a", "A", "A", &[], &["a.stl"]),
                proj("b", "B", "B", &[], &["b.stl"]),
                proj("c", "C", "C", &[], &["c.stl"]),
            ],
        )
        .unwrap();
        let ids = vec![Project::make_id("r1", "C"), Project::make_id("r1", "A"), "r1:gone".to_string()];
        let q = ListQuery {
            sort: SortKey::Collection,
            ..Default::default()
        };
        let out = ix.list(&q, Some(&ids)).unwrap();
        assert_eq!(out.iter().map(|p| p.rel_path.as_str()).collect::<Vec<_>>(), vec!["C", "A"]);
        let titled = ix
            .list(
                &ListQuery {
                    sort: SortKey::Title,
                    ..Default::default()
                },
                Some(&ids),
            )
            .unwrap();
        assert_eq!(titled.iter().map(|p| p.rel_path.as_str()).collect::<Vec<_>>(), vec!["A", "C"]);
        assert!(ix.list(&q, Some(&[])).unwrap().is_empty());
    }

    #[test]
    fn schema_bump_recreates_tables() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("index.sqlite");
        {
            let c = Connection::open(&p).unwrap();
            c.execute_batch("CREATE TABLE projects (id TEXT); INSERT INTO projects VALUES ('old'); PRAGMA user_version = 1;")
                .unwrap();
        }
        let ix = Index::open(&p).unwrap();
        assert_eq!(ix.count(None).unwrap().0, 0);
    }

    #[test]
    fn v2_migrates_in_place_keeping_thumbs() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("index.sqlite");
        {
            // a v2 database: same schema minus files.ext, with one project, its files and a thumb row
            let c = Connection::open(&p).unwrap();
            let v2 = SCHEMA
                .replace(", ext TEXT NOT NULL DEFAULT ''", "")
                .replace("CREATE INDEX IF NOT EXISTS files_ext ON files(ext);", "");
            c.execute_batch(&v2).unwrap();
            c.execute_batch("PRAGMA user_version = 2;").unwrap();
            c.execute("INSERT INTO projects (id, root_id, rel_path, title, total_bytes, file_count, model_count, modified, added, sidecar_state, warnings, thumb_source, thumb_kind) VALUES ('r1:A','r1','A','A',10,2,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','missing','[]','a.STL','render')", []).unwrap();
            c.execute("INSERT INTO files (project_id, rel_path, name, kind, size, modified) VALUES ('r1:A','a.STL','a.STL','model',10,'2026-01-01T00:00:00Z'), ('r1:A','README','README','document',1,'2026-01-01T00:00:00Z')", []).unwrap();
            c.execute("INSERT INTO thumbs (project_id, source_rel, source_size, source_mtime, key, updated) VALUES ('r1:A','a.STL',10,'2026-01-01T00:00:00Z','abcdefabcdefabcdefabcdef.png','2026-01-02T00:00:00Z')", []).unwrap();
        }
        let ix = Index::open(&p).unwrap();
        let version: i64 = ix.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(
            ix.project_of_thumb("abcdefabcdefabcdefabcdef.png").unwrap().as_deref(),
            Some("r1:A")
        );
        let f = ix.facets(None).unwrap();
        assert_eq!(f.file_types.len(), 1);
        assert_eq!(f.file_types[0].value, "stl");
        assert_eq!(
            ix.list(
                &ListQuery {
                    file_type: Some("stl".into()),
                    ..Default::default()
                },
                None
            )
            .unwrap()
            .len(),
            1
        );
    }
}
