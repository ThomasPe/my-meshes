//! `collections.json` in the app data directory: favorites now, manual and smart
//! collections later (docs/spec/02-domain-model.md). Projects are referenced by id
//! (`root_id:rel_path`), so the file stays valid when a root is remounted elsewhere.
//! Rewritten atomically; unknown keys survive a round trip.

use crate::error::{io_err, EngineError, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct CollectionsFile {
    #[serde(default = "schema_v1")]
    schema: u32,
    #[serde(default)]
    favorites: BTreeSet<String>,
    #[serde(default)]
    collections: Vec<serde_json::Value>,
    #[serde(default, rename = "smartCollections")]
    smart_collections: Vec<serde_json::Value>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}
fn schema_v1() -> u32 {
    1
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

    /// A project moved (rename): carry its favorite flag over.
    pub fn rename(&mut self, old_id: &str, new_id: &str) -> Result<()> {
        if self.file.favorites.remove(old_id) {
            self.file.favorites.insert(new_id.to_string());
            self.save()?;
        }
        Ok(())
    }

    pub fn forget(&mut self, project_id: &str) -> Result<()> {
        if self.file.favorites.remove(project_id) {
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
            r#"{"schema":1,"favorites":["r1:A"],"collections":[{"id":"c1","name":"Desk","projects":[]}],"somethingElse":{"x":1}}"#,
        )
        .unwrap();
        let mut s = CollectionsStore::open(t.path()).unwrap();
        assert!(s.is_favorite("r1:A"));
        assert!(s.set_favorite("r1:B", true).unwrap());
        assert!(!s.set_favorite("r1:B", true).unwrap());
        s.rename("r1:A", "r1:A2").unwrap();
        let again = CollectionsStore::open(t.path()).unwrap();
        assert_eq!(again.favorites().iter().cloned().collect::<Vec<_>>(), vec!["r1:A2", "r1:B"]);
        let text = fs::read_to_string(t.path().join("collections.json")).unwrap();
        assert!(text.contains("somethingElse"), "{text}");
        assert!(text.contains("\"Desk\""), "{text}");
    }
}
