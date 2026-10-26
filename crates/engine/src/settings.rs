//! `settings.json` in the app data directory: scanner options and the thumbnail location.
//! Everything the user changes in Settings that the engine needs lives here so it survives
//! a restart (APP-4). Rewritten atomically; unknown keys survive a round trip.

use crate::ai::AiSettings;
use crate::error::{io_err, EngineError, Result};
use crate::model::ThumbLocation;
use crate::scan::{DEFAULT_CONTAINER_DIRS, DEFAULT_IGNORE};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "schema_v1")]
    pub schema: u32,
    /// Glob patterns the scanner skips (files and directories).
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
    /// Sub-folder names that mark a download bundle (`scan::DEFAULT_CONTAINER_DIRS`).
    #[serde(default = "default_containers")]
    pub container_dirs: Vec<String>,
    /// Where rendered previews are written (Q5: app data by default).
    #[serde(default)]
    pub thumb_location: ThumbLocation,
    /// AI assistance (ADR-0003): provider, endpoint and model. Never the key.
    #[serde(default)]
    pub ai: AiSettings,
    /// Creator hints the user dismissed, per project id (META-7 stage 1).
    #[serde(default)]
    pub dismissed_hints: BTreeMap<String, Vec<String>>,
    /// Network use the user opted into (META-7 stage 2). Everything here defaults to off.
    #[serde(default)]
    pub network: NetworkSettings,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Opt-in network features. The privacy policy (site/privacy) lists each one; a new field
/// here needs a new paragraph there before it ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct NetworkSettings {
    /// Load the model page named in a project's source link to fill creator, license and
    /// tags. Sends that URL to its site; nothing else. Off by default.
    #[serde(default)]
    pub fetch_model_pages: bool,
}

fn schema_v1() -> u32 {
    1
}
fn default_ignore() -> Vec<String> {
    DEFAULT_IGNORE.iter().map(|s| s.to_string()).collect()
}
fn default_containers() -> Vec<String> {
    DEFAULT_CONTAINER_DIRS.iter().map(|s| s.to_string()).collect()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema: 1,
            ignore: default_ignore(),
            container_dirs: default_containers(),
            thumb_location: ThumbLocation::default(),
            ai: AiSettings::default(),
            dismissed_hints: BTreeMap::new(),
            network: NetworkSettings::default(),
            extra: BTreeMap::new(),
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    settings: Settings,
}

impl SettingsStore {
    pub fn open(data_dir: &Path) -> Result<SettingsStore> {
        let path = data_dir.join("settings.json");
        let settings = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| EngineError::Serde(format!("settings.json: {e}")))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(EngineError::Io { path, source: e }),
        };
        Ok(SettingsStore { path, settings })
    }

    pub fn get(&self) -> &Settings {
        &self.settings
    }

    /// Applies a change and persists it; the in-memory copy is only updated when the write
    /// succeeded, so a full disk never leaves the engine and the file disagreeing.
    pub fn update(&mut self, f: impl FnOnce(&mut Settings)) -> Result<&Settings> {
        let mut next = self.settings.clone();
        f(&mut next);
        let text = serde_json::to_string_pretty(&next).map_err(|e| EngineError::Serde(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(io_err(&tmp))?;
        fs::rename(&tmp, &self.path).map_err(io_err(&self.path))?;
        self.settings = next;
        Ok(&self.settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_defaults_and_unknown_keys() {
        let t = tempfile::tempdir().unwrap();
        let mut s = SettingsStore::open(t.path()).unwrap();
        assert_eq!(s.get().thumb_location, ThumbLocation::AppData);
        assert!(s.get().ignore.iter().any(|p| p == ".cache"));
        s.update(|s| {
            s.thumb_location = ThumbLocation::Project;
            s.ignore.push("*.bak".into());
        })
        .unwrap();
        // an older/newer app may have written keys we do not know
        let path = t.path().join("settings.json");
        let mut v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        v["futureKey"] = serde_json::json!({ "a": 1 });
        fs::write(&path, v.to_string()).unwrap();
        let mut again = SettingsStore::open(t.path()).unwrap();
        assert_eq!(again.get().thumb_location, ThumbLocation::Project);
        assert!(again.get().ignore.iter().any(|p| p == "*.bak"));
        again.update(|s| s.container_dirs = vec!["files".into()]).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("futureKey"));
        assert!(text.contains("\"project\""));
        // network features are off until the user turns them on, and the choice survives
        assert!(!again.get().network.fetch_model_pages);
        again.update(|s| s.network.fetch_model_pages = true).unwrap();
        assert!(SettingsStore::open(t.path()).unwrap().get().network.fetch_model_pages);
    }
}
