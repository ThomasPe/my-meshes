//! Meshkeep engine. Everything here is independent of the application shell (Tauri):
//! it only knows about directories, files and an SQLite file it may rebuild at any time.
//!
//! Rules this crate enforces (see docs/spec):
//! - The file system and `project.yaml` sidecars are the source of truth; the index is a cache.
//! - Scanning never writes to a library. Sidecars are created lazily, on the first edit.
//! - Sidecar writes are atomic (temp file + rename) and refuse to overwrite external changes.
//! - A missing root is reported as offline; its projects are never deleted from the index.

pub mod ai;
pub mod collections;
pub mod error;
pub mod hash;
pub mod import;
pub mod index;
pub mod model;
pub mod roots;
pub mod scan;
pub mod settings;
pub mod sidecar;
pub mod threemf;
pub mod thumbs;
pub mod watch;

mod engine;
pub use engine::{
    BatchReport, BatchUpdate, Deleter, Engine, MoveReport, PromoteFailure, PromoteItem, PromoteReport, ScanProgress, UpdateMetadata,
};
pub use error::{EngineError, Result};
