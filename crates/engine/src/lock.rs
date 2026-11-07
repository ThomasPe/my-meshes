//! The one engine, shared between the window's commands, the watcher, the poll loop and the
//! MCP endpoint. A plain mutex with two diagnostics on top: a caller that waits long for the
//! lock, and a holder that keeps it long, each leave a warning in the log with their source
//! location. That is the line to look for when the window "did nothing" for a while; the
//! spec wants heavy work off the UI path, and this is how a regression shows up in a log a
//! user sends in.

use crate::Engine;
use std::ops::{Deref, DerefMut};
use std::panic::Location;
use std::sync::{LockResult, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// Waiting or holding longer than this is logged.
pub const SLOW_LOCK: Duration = Duration::from_secs(1);

pub struct SharedEngine {
    inner: Mutex<Engine>,
}

/// A locked engine; logs when it was held longer than [`SLOW_LOCK`] when dropped.
pub struct EngineGuard<'a> {
    guard: MutexGuard<'a, Engine>,
    since: Instant,
    caller: &'static Location<'static>,
}

impl SharedEngine {
    pub fn new(engine: Engine) -> SharedEngine {
        SharedEngine { inner: Mutex::new(engine) }
    }

    /// Locks like `Mutex::lock`; `.unwrap()` at the call sites stays as it was.
    #[track_caller]
    pub fn lock(&self) -> LockResult<EngineGuard<'_>> {
        let caller = Location::caller();
        let started = Instant::now();
        let result = self.inner.lock();
        let waited = started.elapsed();
        if waited >= SLOW_LOCK {
            tracing::warn!("engine lock: {} waited {} ms", short(caller), waited.as_millis());
        }
        let wrap = |guard| EngineGuard {
            guard,
            since: Instant::now(),
            caller,
        };
        match result {
            Ok(guard) => Ok(wrap(guard)),
            Err(poisoned) => Err(PoisonError::new(wrap(poisoned.into_inner()))),
        }
    }

    /// Like `Mutex::try_lock`: `None` while someone else holds the engine.
    #[track_caller]
    pub fn try_lock(&self) -> Option<EngineGuard<'_>> {
        let caller = Location::caller();
        self.inner.try_lock().ok().map(|guard| EngineGuard {
            guard,
            since: Instant::now(),
            caller,
        })
    }
}

impl Deref for EngineGuard<'_> {
    type Target = Engine;
    fn deref(&self) -> &Engine {
        &self.guard
    }
}
impl DerefMut for EngineGuard<'_> {
    fn deref_mut(&mut self) -> &mut Engine {
        &mut self.guard
    }
}
impl Drop for EngineGuard<'_> {
    fn drop(&mut self) {
        let held = self.since.elapsed();
        if held >= SLOW_LOCK {
            tracing::warn!("engine lock: {} held it {} ms", short(self.caller), held.as_millis());
        }
    }
}

/// `src-tauri/src/commands.rs:231` rather than the full build path.
fn short(loc: &Location<'_>) -> String {
    let file = loc.file().replace('\\', "/");
    let tail = file
        .rsplit('/')
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("/");
    format!("{tail}:{}", loc.line())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_like_a_mutex_and_reports_poison() {
        let data = tempfile::tempdir().unwrap();
        let shared = SharedEngine::new(Engine::open(data.path()).unwrap());
        {
            let mut e = shared.lock().unwrap();
            e.set_ignore_patterns(vec!["*.bak".into()]).unwrap();
            assert!(shared.try_lock().is_none(), "held");
        }
        assert_eq!(shared.lock().unwrap().ignore_patterns(), ["*.bak"]);
        assert!(shared.try_lock().is_some());
        let loc = Location::caller();
        assert!(short(loc).ends_with(&format!("src/lock.rs:{}", loc.line())), "{}", short(loc));
    }
}
