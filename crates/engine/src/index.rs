//! SQLite cache of everything the scanner found, with FTS5 search. Disposable by design:
//! `Index::rebuild_root` replaces a root's rows wholesale from a scan.

use crate::error::Result;
use crate::model::{FileEntry, FileKind, FolderNode, ListQuery, Project, ProjectSummary, SidecarState, SortKey, TagCount};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::Path;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub struct Index {
    conn: Connection,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, root_id TEXT NOT NULL, rel_path TEXT NOT NULL, title TEXT NOT NULL,
  creator TEXT, license TEXT, source_url TEXT, description TEXT, material TEXT, supports_required INTEGER,
  thumbnail TEXT, total_bytes INTEGER NOT NULL, file_count INTEGER NOT NULL, model_count INTEGER NOT NULL,
  modified TEXT NOT NULL, sidecar_state TEXT NOT NULL, sidecar_message TEXT, warnings TEXT NOT NULL, offline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS projects_root ON projects(root_id, rel_path);
CREATE TABLE IF NOT EXISTS files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, modified TEXT NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);
CREATE TABLE IF NOT EXISTS tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (project_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(id UNINDEXED, title, creator, description, tags, filenames, tokenize='unicode61 remove_diacritics 2');
"#;

fn ts(t: &OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}
fn parse_ts(s: &str) -> OffsetDateTime {
    OffsetDateTime::parse(s, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
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
        conn.execute_batch(SCHEMA)?;
        Ok(Index { conn })
    }

    /// Replaces all rows of a root with the given projects, in one transaction.
    pub fn rebuild_root(&mut self, root_id: &str, projects: &[Project]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM projects_fts WHERE id IN (SELECT id FROM projects WHERE root_id = ?1)", params![root_id])?;
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
        Ok(())
    }

    fn insert_project(tx: &rusqlite::Transaction, p: &Project) -> Result<()> {
        let (state, msg) = match &p.sidecar {
            SidecarState::Missing => ("missing", None),
            SidecarState::Ok => ("ok", None),
            SidecarState::Malformed(m) => ("malformed", Some(m.as_str())),
        };
        tx.execute(
            "INSERT INTO projects (id, root_id, rel_path, title, creator, license, source_url, description, material, supports_required, thumbnail, total_bytes, file_count, model_count, modified, sidecar_state, sidecar_message, warnings, offline)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            params![p.id, p.root_id, p.rel_path, p.title, p.creator, p.license, p.source_url, p.description, p.material, p.supports_required.map(|b| b as i32), p.thumbnail, p.total_bytes as i64, p.files.len() as i64, p.model_count as i64, ts(&p.modified), state, msg, serde_json::to_string(&p.warnings).unwrap_or_default(), p.offline as i32],
        )?;
        let mut fs_stmt = tx.prepare_cached("INSERT INTO files (project_id, rel_path, name, kind, size, modified) VALUES (?1,?2,?3,?4,?5,?6)")?;
        for f in &p.files {
            fs_stmt.execute(params![p.id, f.rel_path, f.name, kind_str(f.kind), f.size as i64, ts(&f.modified)])?;
        }
        let mut tag_stmt = tx.prepare_cached("INSERT OR IGNORE INTO tags (project_id, tag) VALUES (?1, ?2)")?;
        for t in &p.tags {
            tag_stmt.execute(params![p.id, t.to_lowercase()])?;
        }
        tx.execute(
            "INSERT INTO projects_fts (id, title, creator, description, tags, filenames) VALUES (?1,?2,?3,?4,?5,?6)",
            params![p.id, p.title, p.creator, p.description, p.tags.join(" "), p.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>().join(" ")],
        )?;
        Ok(())
    }

    pub fn mark_root_offline(&mut self, root_id: &str, offline: bool) -> Result<()> {
        self.conn.execute("UPDATE projects SET offline = ?2 WHERE root_id = ?1", params![root_id, offline as i32])?;
        Ok(())
    }

    pub fn remove_root(&mut self, root_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM projects_fts WHERE id IN (SELECT id FROM projects WHERE root_id = ?1)", params![root_id])?;
        self.conn.execute("DELETE FROM projects WHERE root_id = ?1", params![root_id])?;
        Ok(())
    }

    pub fn project(&self, id: &str) -> Result<Option<Project>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, root_id, rel_path, title, creator, license, source_url, description, material, supports_required, thumbnail, total_bytes, model_count, modified, sidecar_state, sidecar_message, warnings, offline FROM projects WHERE id = ?1",
                params![id],
                |r| {
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
                    })
                },
            )
            .optional()?;
        let Some(mut p) = row else { return Ok(None) };
        p.tags = self.tags_of(id)?;
        let mut st = self.conn.prepare_cached("SELECT rel_path, name, kind, size, modified FROM files WHERE project_id = ?1 ORDER BY rel_path")?;
        p.files = st
            .query_map(params![id], |r| {
                Ok(FileEntry { rel_path: r.get(0)?, name: r.get(1)?, kind: kind_parse(&r.get::<_, String>(2)?), size: r.get::<_, i64>(3)? as u64, modified: parse_ts(&r.get::<_, String>(4)?) })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Some(p))
    }

    fn tags_of(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self.conn.prepare_cached("SELECT tag FROM tags WHERE project_id = ?1 ORDER BY tag")?;
        let tags = st.query_map(params![id], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn list(&self, q: &ListQuery) -> Result<Vec<ProjectSummary>> {
        let mut sql = String::from("SELECT p.id, p.root_id, p.rel_path, p.title, p.creator, p.thumbnail, p.file_count, p.model_count, p.total_bytes, p.modified, p.sidecar_state, p.offline FROM projects p");
        let mut where_: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = q.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            // prefix match on every term, so typing feels instant
            let fts = text.split_whitespace().map(|t| format!("\"{}\"*", t.replace('"', ""))).collect::<Vec<_>>().join(" ");
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
            args.push(Box::new(format!("{}/%", prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))));
        }
        for tag in &q.tags {
            where_.push("EXISTS (SELECT 1 FROM tags t WHERE t.project_id = p.id AND t.tag = ?)".into());
            args.push(Box::new(tag.to_lowercase()));
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
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = rows;
        for p in &mut out {
            p.tags = self.tags_of(&p.id)?;
        }
        Ok(out)
    }

    pub fn tag_counts(&self, root_id: Option<&str>) -> Result<Vec<TagCount>> {
        let mut st = self.conn.prepare(
            "SELECT t.tag, COUNT(*) FROM tags t JOIN projects p ON p.id = t.project_id WHERE (?1 IS NULL OR p.root_id = ?1) GROUP BY t.tag ORDER BY COUNT(*) DESC, t.tag",
        )?;
        let rows = st.query_map(params![root_id], |r| Ok(TagCount { tag: r.get(0)?, count: r.get::<_, i64>(1)? as u32 }))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn count(&self, root_id: Option<&str>) -> Result<(u32, u64)> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_bytes),0) FROM projects WHERE (?1 IS NULL OR root_id = ?1)",
            params![root_id],
            |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, i64>(1)? as u64)),
        )?)
    }

    /// Folder tree of one root, derived from project paths (every ancestor directory appears).
    pub fn folder_tree(&self, root_id: &str) -> Result<Vec<FolderNode>> {
        let mut st = self.conn.prepare("SELECT rel_path FROM projects WHERE root_id = ?1")?;
        let paths: Vec<String> = st.query_map(params![root_id], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
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
                    let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
                    FolderNode { name: name.clone(), rel_path: rel.clone(), project_count: child.count, children: build(&rel, child) }
                })
                .collect()
        }
        Ok(build("", &root))
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
            files: files.iter().map(|f| FileEntry { rel_path: f.to_string(), name: f.to_string(), kind: FileKind::from_extension(f.rsplit('.').next().unwrap()), size: 10, modified: OffsetDateTime::UNIX_EPOCH }).collect(),
            total_bytes: 10 * files.len() as u64,
            model_count: files.iter().filter(|f| f.ends_with(".stl")).count() as u32,
            modified: OffsetDateTime::UNIX_EPOCH,
            sidecar: SidecarState::Missing,
            sidecar_stamp: None,
            warnings: vec![],
            offline: false,
        }
    }

    #[test]
    fn rebuild_list_search_and_tree() {
        let mut ix = Index::open_in_memory().unwrap();
        ix.rebuild_root("r1", &[
            proj("a", "Gridfinity/Bins", "Gridfinity Bins", &["gridfinity", "organizer"], &["bin_1x1.stl"]),
            proj("b", "Gridfinity/Lids", "Lids", &["gridfinity"], &["lid.stl"]),
            proj("c", "Robotics/Arm", "Robotic Arm v4", &["robotics"], &["base.stl", "bom.pdf"]),
        ]).unwrap();
        assert_eq!(ix.count(None).unwrap().0, 3);
        let all = ix.list(&ListQuery::default()).unwrap();
        assert_eq!(all.len(), 3);
        let grid = ix.list(&ListQuery { tags: vec!["gridfinity".into()], ..Default::default() }).unwrap();
        assert_eq!(grid.len(), 2);
        let search = ix.list(&ListQuery { text: Some("robo".into()), ..Default::default() }).unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].title, "Robotic Arm v4");
        let by_file = ix.list(&ListQuery { text: Some("bom".into()), ..Default::default() }).unwrap();
        assert_eq!(by_file.len(), 1);
        let under = ix.list(&ListQuery { path_prefix: Some("Gridfinity".into()), ..Default::default() }).unwrap();
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
        // rebuild replaces
        ix.rebuild_root("r1", &[proj("a", "Gridfinity/Bins", "Bins", &[], &["bin.stl"])]).unwrap();
        assert_eq!(ix.count(None).unwrap().0, 1);
        ix.mark_root_offline("r1", true).unwrap();
        assert!(ix.list(&ListQuery::default()).unwrap()[0].offline);
    }
}
