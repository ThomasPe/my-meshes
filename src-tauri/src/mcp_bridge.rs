//! `meshkeep --mcp [url] [token]`: a stdio MCP server for clients that only launch commands
//! (Claude Desktop). Each line on stdin is forwarded to the running app's HTTP endpoint and
//! the answer written back as one line. Nothing else may touch stdout: it is the protocol
//! channel. The token can also come from `MESHKEEP_MCP_TOKEN`.

use std::io::{BufRead, Write};
use std::time::Duration;

pub const DEFAULT_URL: &str = "http://127.0.0.1:7340/mcp";

/// Runs until stdin closes. Returns the process exit code.
pub fn run(url: &str, token: &str) -> i32 {
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(900)).build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("meshkeep --mcp: {e}");
            return 2;
        }
    };
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = forward(&client, url, token, &line);
        if let Some(text) = reply {
            let mut out = stdout.lock();
            if out
                .write_all(text.as_bytes())
                .and_then(|_| out.write_all(b"\n"))
                .and_then(|_| out.flush())
                .is_err()
            {
                break;
            }
        }
    }
    0
}

/// One message in, at most one line out. Transport failures become a JSON-RPC error for the
/// request's id so the client shows the reason instead of hanging.
pub fn forward(client: &reqwest::blocking::Client, url: &str, token: &str, line: &str) -> Option<String> {
    let id = serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .filter(|v| !v.is_null());
    let result = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Connection", "close")
        .body(line.to_string())
        .send();
    let fail = |message: String| {
        id.as_ref()
            .map(|id| serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string())
    };
    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().unwrap_or_default();
            match status {
                200 => serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .map(|v| v.to_string())
                    .or_else(|| fail("Meshkeep returned something that is not JSON".into())),
                202 => None,
                401 => fail("Meshkeep rejected the token; copy the current one from Settings → MCP server".into()),
                _ => fail(format!("Meshkeep answered {status}: {}", body.trim())),
            }
        }
        Err(e) => fail(if e.is_connect() {
            format!("Meshkeep is not running or its MCP server is off ({url}); start the app and enable the server in Settings")
        } else {
            format!("cannot reach Meshkeep: {e}")
        }),
    }
}
