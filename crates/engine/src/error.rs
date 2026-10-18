use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("root not found: {0}")]
    RootNotFound(String),
    #[error("root is offline: {0}")]
    RootOffline(PathBuf),
    #[error("path is not a directory: {0}")]
    NotADirectory(PathBuf),
    #[error("root already registered: {0}")]
    RootExists(PathBuf),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("project.yaml changed on disk since it was read; reload before saving")]
    SidecarConflict,
    #[error("invalid project.yaml: {0}")]
    SidecarInvalid(String),
    #[error("index error: {0}")]
    Index(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serde(String),
    #[error("invalid ignore pattern: {0}")]
    Pattern(String),
    #[error("watch error: {0}")]
    Watch(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

pub(crate) fn io_err(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> EngineError {
    let path = path.into();
    move |source| EngineError::Io { path, source }
}
