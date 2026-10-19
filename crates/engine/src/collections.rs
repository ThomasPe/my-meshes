//! `collections.json` in the app data directory: favorites, manual collections and smart
//! collections (docs/spec/02-domain-model.md). Projects are referenced by id
//! (`root_id:rel_path`), so the file stays valid when a root is remounted elsewhere.
//! Rewritten atomically; unknown keys survive a round trip.

use crate::error::{io_err, EngineError, Result};
use crate::model::ListQuery;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// An ordered, user-curated set of projects (NAV-7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// A saved query evaluated live (NAV-8). The query is a `ListQuery` subset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartCollection {
    pub id: String,
    pub name: String,
    pub query: ListQuery,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CollectionsFile {
    #[serde(default = "schema_v1")]
    schema: u32,
    #[serde(default)]
    favorites: BTreeSet<String>,
    #[serde(default)]
    collections: Vec<Collection>,
    #[serde(default, rename = "smartCollections")]
    smart_collections: Vec<SmartCollection>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}
fn schema_v1() -> u32 {
    1
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

fn clean_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(EngineError::InvalidName("collection name is empty".into()));
    }
    if n.len() > 120 {
        return Err(EngineError::InvalidName("collection name is too long".into()));
    }
    Ok(n.to_string())
}

pub struct CollectionsStore {
    path: PathBuf,
    file: CollectionsFile,
}

impl CollectionsStore {
    pub fn open(data_dir: &Path) -> Result<CollectionsStore> {
        let path = data_dir.join("collections.json");
        let file = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| EngineError::Serde(format!("collections.json: {e}")))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => CollectionsFile::default(),
            Err(e) => return Err(EngineError::Io { path, source: e }),
        };
        Ok(CollectionsStore { path, file })
    }

    // ---- favorites --------------------------------------------------------------------

    pub fn favorites(&self) -> &BTreeSet<String> {
        &self.file.favorites
    }

    pub fn is_favorite(&self, project_id: &str) -> bool {
        self.file.favorites.contains(project_id)
    }

    /// Returns whether anything changed.
    pub fn set_favorite(&mut self, project_id: &str, favorite: bool) -> Result<bool> {
        let changed = if favorite {
            self.file.favorites.insert(project_id.to_string())
        } else {
            self.file.favorites.remove(project_id)
        };
        if changed {
            self.save()?;
        }
        Ok(changed)
    }

    // ---- manual collections -----------------------------------------------------------

    pub fn collections(&self) -> &[Collection] {
        &self.file.collections
    }

    pub fn collection(&self, id: &str) -> Result<&Collection> {
        self.file
            .collections
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| EngineError::ProjectNotFound(format!("collection {id}")))
    }

    fn collection_mut(&mut self, id: &str) -> Result<&mut Collection> {
        self.file
            .collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| EngineError::ProjectNotFound(format!("collection {id}")))
    }

    pub fn create_collection(&mut self, name: &str) -> Result<Collection> {
        let c = Collection {
            id: new_id("c"),
            name: clean_name(name)?,
            projects: Vec::new(),
            extra: BTreeMap::new(),
        };
        self.file.collections.push(c.clone());
        self.save()?;
        Ok(c)
    }

    pub fn rename_collection(&mut self, id: &str, name: &str) -> Result<Collection> {
        let name = clean_name(name)?;
        let c = self.collection_mut(id)?;
        c.name = name;
        let out = c.clone();
        self.save()?;
        Ok(out)
    }

    pub fn delete_collection(&mut self, id: &str) -> Result<()> {
        let before = self.file.collections.len();
        self.file.collections.retain(|c| c.id != id);
        if self.file.collections.len() == before {
            return Err(EngineError::ProjectNotFound(format!("collection {id}")));
        }
        self.save()
    }

    /// Appends projects not already in the collection, keeping order. Returns the collection.
    pub fn add_to_collection(&mut self, id: &str, project_ids: &[String]) -> Result<Collection> {
        let c = self.collection_mut(id)?;
        for p in project_ids {
            if !c.projects.contains(p) {
                c.projects.push(p.clone());
            }
        }
        let out = c.clone();
        self.save()?;
        Ok(out)
    }

    pub fn remove_from_collection(&mut self, id: &str, project_ids: &[String]) -> Result<Collection> {
        let c = self.collection_mut(id)?;
        c.projects.retain(|p| !project_ids.contains(p));
        let out = c.clone();
        self.save()?;
        Ok(out)
    }

    /// Replaces the order. Ids not in the collection are ignored; members missing from
    /// `order` keep their relative order at the end.
    pub fn reorder_collection(&mut self, id: &str, order: &[String]) -> Result<Collection> {
        let c = self.collection_mut(id)?;
        let mut next: Vec<String> = order.iter().filter(|p| c.projects.contains(p)).cloned().collect();
        next.dedup();
        for p in &c.projects {
            if !next.contains(p) {
                next.push(p.clone());
            }
        }
        c.projects = next;
        let out = c.clone();
        self.save()?;
        Ok(out)
    }

    // ---- smart collections ------------------------------------------------------------

    pub fn smart_collections(&self) -> &[SmartCollection] {
        &self.file.smart_collections
    }

    pub fn smart_collection(&self, id: &str) -> Result<&SmartCollection> {
        self.file
            .smart_collections
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| EngineError::ProjectNotFound(format!("smart collection {id}")))
    }

    pub fn create_smart_collection(&mut self, name: &str, query: ListQuery) -> Result<SmartCollection> {
        let s = SmartCollection {
            id: new_id("s"),
            name: clean_name(name)?,
            query: ListQuery {
                collection_id: None,
                limit: None,
                offset: None,
                ..query
            },
            extra: BTreeMap::new(),
        };
        self.file.smart_collections.push(s.clone());
        self.save()?;
        Ok(s)
    }

    pub fn update_smart_collection(&mut self, id: &str, name: Option<&str>, query: Option<ListQuery>) -> Result<SmartCollection> {
        let name = name.map(clean_name).transpose()?;
        let s = self
            .file
            .smart_collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| EngineError::ProjectNotFound(format!("smart collection {id}")))?;
        if let Some(n) = name {
            s.name = n;
        }
        if let Some(q) = query {
            s.query = ListQuery {
                collection_id: None,
                limit: None,
                offset: None,
                ..q
            };
        }
        let out = s.clone();
        self.save()?;
        Ok(out)
    }

    pub fn delete_smart_collection(&mut self, id: &str) -> Result<()> {
        let before = self.file.smart_collections.len();
        self.file.smart_collections.retain(|c| c.id != id);
        if self.file.smart_collections.len() == before {
            return Err(EngineError::ProjectNotFound(format!("smart collection {id}")));
        }
        self.save()
    }

    // ---- project lifecycle ------------------------------------------------------------

    /// A project moved (rename): favorites and collection memberships follow it.
    pub fn rename(&mut self, old_id: &str, new_id: &str) -> Result<()> {
        let mut changed = false;
        if self.file.favorites.remove(old_id) {
            self.file.favorites.insert(new_id.to_string());
            changed = true;
        }
        for c in &mut self.file.collections {
            for p in &mut c.projects {
                if p == old_id {
                    *p = new_id.to_string();
                    changed = true;
                }
            }
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// A project is gone: drop every reference.
    pub fn forget(&mut self, project_id: &str) -> Result<()> {
        let mut changed = self.file.favorites.remove(project_id);
        for c in &mut self.file.collections {
            let before = c.projects.len();
            c.projects.retain(|p| p != project_id);
            changed |= c.projects.len() != before;
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&self.file).map_err(|e| EngineError::Serde(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(io_err(&tmp))?;
        fs::rename(&tmp, &self.path).map_err(io_err(&self.path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favorites_roundtrip_and_preserve_unknown_keys() {
        let t = tempfile::tempdir().unwrap();
        fs::write(
            t.path().join("collections.json"),
            r#"{"schema":1,"favorites":["r1:A"],"collections":[{"id":"c1","name":"Desk","projects":["r1:A"],"color":"red"}],"somethingElse":{"x":1}}"#,
        )
        .unwrap();
        let mut s = CollectionsStore::open(t.path()).unwrap();
        assert!(s.is_favorite("r1:A"));
        assert!(s.set_favorite("r1:B", true).unwrap());
        assert!(!s.set_favorite("r1:B", true).unwrap());
        s.rename("r1:A", "r1:A2").unwrap();
        let again = CollectionsStore::open(t.path()).unwrap();
        assert_eq!(again.favorites().iter().cloned().collect::<Vec<_>>(), vec!["r1:A2", "r1:B"]);
        assert_eq!(
            again.collections()[0].projects,
            vec!["r1:A2"],
            "collection membership follows a rename"
        );
        let text = fs::read_to_string(t.path().join("collections.json")).unwrap();
        assert!(text.contains("somethingElse"), "{text}");
        assert!(
            text.contains("\"color\": \"red\""),
            "unknown keys inside a collection survive: {text}"
        );
    }

    #[test]
    fn collections_crud_order_and_forget() {
        let t = tempfile::tempdir().unwrap();
        let mut s = CollectionsStore::open(t.path()).unwrap();
        assert!(matches!(s.create_collection("  "), Err(EngineError::InvalidName(_))));
        let c = s.create_collection(" Desk setup ").unwrap();
        assert_eq!(c.name, "Desk setup");
        let c = s.add_to_collection(&c.id, &["r1:A".into(), "r1:B".into(), "r1:A".into()]).unwrap();
        assert_eq!(c.projects, vec!["r1:A", "r1:B"]);
        let c = s.add_to_collection(&c.id, &["r1:C".into()]).unwrap();
        let c = s
            .reorder_collection(&c.id, &["r1:C".into(), "r1:A".into(), "r1:zzz".into()])
            .unwrap();
        assert_eq!(c.projects, vec!["r1:C", "r1:A", "r1:B"]);
        let c = s.remove_from_collection(&c.id, &["r1:A".into()]).unwrap();
        assert_eq!(c.projects, vec!["r1:C", "r1:B"]);
        s.forget("r1:B").unwrap();
        assert_eq!(s.collection(&c.id).unwrap().projects, vec!["r1:C"]);
        let c = s.rename_collection(&c.id, "Bench").unwrap();
        assert_eq!(c.name, "Bench");
        assert!(matches!(s.rename_collection("nope", "x"), Err(EngineError::ProjectNotFound(_))));

        let q = ListQuery {
            tags: vec!["gridfinity".into()],
            favorites: true,
            limit: Some(5),
            collection_id: Some("c_x".into()),
            ..Default::default()
        };
        let sm = s.create_smart_collection("Gridfinity favs", q).unwrap();
        assert_eq!(sm.query.tags, vec!["gridfinity"]);
        assert!(
            sm.query.limit.is_none() && sm.query.collection_id.is_none(),
            "paging and collection scope are not part of a saved query"
        );
        let sm = s.update_smart_collection(&sm.id, Some("Grid"), None).unwrap();
        assert_eq!(sm.name, "Grid");
        assert!(sm.query.favorites);

        let again = CollectionsStore::open(t.path()).unwrap();
        assert_eq!(again.collections().len(), 1);
        assert_eq!(again.smart_collections().len(), 1);
        s.delete_collection(&c.id).unwrap();
        s.delete_smart_collection(&sm.id).unwrap();
        assert!(matches!(s.delete_collection(&c.id), Err(EngineError::ProjectNotFound(_))));
        assert!(CollectionsStore::open(t.path()).unwrap().collections().is_empty());
    }
}
