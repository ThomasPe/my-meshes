//! The local MCP endpoint (ADR-0004): a small HTTP server on 127.0.0.1 that hands JSON-RPC
//! messages to `meshkeep_engine::mcp`. Transport only: the token check, the Origin check
//! (no browser page may reach it), one request at a time against the shared engine, and an
//! event per change so the open window follows what an agent did.
//!
//! Streamable HTTP, the simple half: every message is a POST, the answer is JSON (no SSE
//! stream, no session ids), notifications get 202. `GET` is 405 because the server never
//! sends messages on its own. A connection a client keeps open outlives `stop()` until the
//! client gives up on it (tiny_http closes only on the request's own `Connection: close`),
//! so the bridge sends that header; a stopped server refuses new connections at once.

use meshkeep_engine::mcp::{self, Change};
use meshkeep_engine::Engine;
use serde::Serialize;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tiny_http::{Header, Method, Request, Response, Server};

/// Called with the changes a message made, after the engine lock is released.
pub type OnChange = Arc<dyn Fn(&[Change]) + Send + Sync>;

#[derive(Default)]
struct Stats {
    requests: AtomicU64,
    rejected: AtomicU64,
    last_request_at: Mutex<Option<time::OffsetDateTime>>,
}

struct Running {
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
    port: u16,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// What the Settings page shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
    pub requests: u64,
    pub rejected: u64,
    pub last_request_at: Option<String>,
}

/// Owns the server thread; `apply` makes it match the settings.
#[derive(Default)]
pub struct Host {
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    stats: Arc<Stats>,
}

impl Host {
    pub fn new() -> Host {
        Host::default()
    }

    /// Starts on `addr` ("127.0.0.1:0" picks a free port) and returns the port in use.
    pub fn start(&self, addr: &str, token: String, engine: Arc<Mutex<Engine>>, on_change: OnChange) -> Result<u16, String> {
        self.stop();
        let server = Server::http(addr).map_err(|e| format!("cannot listen on {addr}: {e}"))?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let server = Arc::new(server);
        let stats = self.stats.clone();
        let srv = server.clone();
        let thread = std::thread::Builder::new()
            .name("meshkeep-mcp".into())
            .spawn(move || {
                while let Ok(mut req) = srv.recv() {
                    let response = handle(&mut req, &token, &engine, &on_change, &stats);
                    let _ = req.respond(response);
                }
            })
            .map_err(|e| e.to_string())?;
        *self.running.lock().unwrap() = Some(Running {
            server,
            thread: Some(thread),
            port,
        });
        *self.error.lock().unwrap() = None;
        log::info!("MCP server listening on 127.0.0.1:{port}");
        Ok(port)
    }

    pub fn stop(&self) {
        if let Some(r) = self.running.lock().unwrap().take() {
            log::info!("MCP server on port {} stopped", r.port);
            drop(r);
        }
    }

    /// Starts, stops or restarts so the server matches the settings; a failure to bind is
    /// kept for the status line instead of failing the settings change.
    pub fn apply(&self, settings: &meshkeep_engine::settings::McpSettings, engine: Arc<Mutex<Engine>>, on_change: OnChange) {
        if !settings.enabled || settings.token.is_empty() {
            self.stop();
            *self.error.lock().unwrap() = None;
            return;
        }
        if let Err(e) = self.start(&format!("127.0.0.1:{}", settings.port), settings.token.clone(), engine, on_change) {
            log::warn!("{e}");
            *self.error.lock().unwrap() = Some(e);
        }
    }

    pub fn status(&self, configured_port: u16) -> McpStatus {
        let running = self.running.lock().unwrap();
        McpStatus {
            running: running.is_some(),
            port: running.as_ref().map(|r| r.port).unwrap_or(configured_port),
            error: self.error.lock().unwrap().clone(),
            requests: self.stats.requests.load(Ordering::Relaxed),
            rejected: self.stats.rejected.load(Ordering::Relaxed),
            last_request_at: self
                .stats
                .last_request_at
                .lock()
                .unwrap()
                .map(|t| t.format(&time::format_description::well_known::Rfc3339).unwrap_or_default()),
        }
    }
}

type Reply = Response<std::io::Cursor<Vec<u8>>>;

fn json_reply(status: u16, body: String) -> Reply {
    Response::from_string(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").expect("static header"))
}

fn header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

/// Browsers send an Origin; only the machine itself may talk to this port (DNS rebinding
/// protection as the MCP transport spec asks for).
fn origin_ok(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => {
            let o = o.trim().to_ascii_lowercase();
            o == "null" || o.starts_with("http://localhost") || o.starts_with("http://127.0.0.1") || o.starts_with("http://[::1]")
        }
    }
}

fn handle(req: &mut Request, token: &str, engine: &Arc<Mutex<Engine>>, on_change: &OnChange, stats: &Stats) -> Reply {
    let path = req.url().split('?').next().unwrap_or("/");
    if path != "/mcp" && path != "/" {
        return json_reply(404, r#"{"error":"not found"}"#.into());
    }
    if !origin_ok(header(req, "Origin")) {
        stats.rejected.fetch_add(1, Ordering::Relaxed);
        return json_reply(403, r#"{"error":"origin not allowed"}"#.into());
    }
    let presented = header(req, "Authorization")
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")))
        .map(str::trim);
    if presented != Some(token) || token.is_empty() {
        stats.rejected.fetch_add(1, Ordering::Relaxed);
        return json_reply(401, r#"{"error":"missing or wrong token"}"#.into())
            .with_header(Header::from_bytes("WWW-Authenticate", "Bearer").expect("static header"));
    }
    match req.method() {
        Method::Post => {}
        Method::Delete => return json_reply(200, "{}".into()),
        _ => {
            return json_reply(405, r#"{"error":"POST a JSON-RPC message"}"#.into())
                .with_header(Header::from_bytes("Allow", "POST, DELETE").expect("static header"))
        }
    }
    let mut body = String::new();
    if let Err(e) = req.as_reader().take(16 << 20).read_to_string(&mut body) {
        return json_reply(400, format!(r#"{{"error":"{e}"}}"#));
    }
    stats.requests.fetch_add(1, Ordering::Relaxed);
    *stats.last_request_at.lock().unwrap() = Some(time::OffsetDateTime::now_utc());
    let message: serde_json::Value =
        match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(e) => return json_reply(
                400,
                serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": format!("parse error: {e}") } })
                    .to_string(),
            ),
        };
    let outcome = {
        let mut engine = engine.lock().unwrap();
        mcp::handle(&mut engine, &message)
    };
    if !outcome.changes.is_empty() {
        on_change(&outcome.changes);
    }
    match outcome.response {
        Some(r) => json_reply(200, r.to_string()),
        None => Response::from_string("").with_status_code(202),
    }
}
