//! The MCP endpoint over a real socket: token and Origin checks, JSON in and out, and the
//! change callback that keeps the window in sync.
use meshkeep_engine::settings::McpSettings;
use meshkeep_engine::Engine;
use meshkeep_lib::mcp_host::Host;
use std::sync::{Arc, Mutex};

#[test]
fn serves_mcp_over_http_with_a_token() {
    let data = tempfile::tempdir().unwrap();
    let mut engine = Engine::open(data.path()).unwrap();
    engine
        .set_mcp_settings(McpSettings {
            enabled: true,
            token: "secret-token".into(),
            allow_writes: false,
            ..Default::default()
        })
        .unwrap();
    let engine = Arc::new(Mutex::new(engine));
    let seen = Arc::new(Mutex::new(0usize));
    let counter = seen.clone();
    let host = Host::new();
    let port = host
        .start(
            "127.0.0.1:0",
            "secret-token".into(),
            engine.clone(),
            Arc::new(move |changes| *counter.lock().unwrap() += changes.len()),
        )
        .unwrap();
    assert!(port > 0);
    assert!(host.status(0).running);
    let url = format!("http://127.0.0.1:{port}/mcp");
    let client = reqwest::blocking::Client::new();
    let post = |body: &str, token: Option<&str>, origin: Option<&str>| {
        let mut r = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Connection", "close")
            .body(body.to_string());
        if let Some(t) = token {
            r = r.header("Authorization", format!("Bearer {t}"));
        }
        if let Some(o) = origin {
            r = r.header("Origin", o);
        }
        r.send().unwrap()
    };
    let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}"#;

    // no token, wrong token, a web page's origin: refused before anything runs
    assert_eq!(post(init, None, None).status(), 401);
    assert_eq!(post(init, Some("other"), None).status(), 401);
    assert_eq!(post(init, Some("secret-token"), Some("https://evil.example")).status(), 403);
    assert_eq!(host.status(0).rejected, 3);

    let r = post(init, Some("secret-token"), Some("http://localhost:1420"));
    assert_eq!(r.status(), 200);
    let v: serde_json::Value = r.json().unwrap();
    assert_eq!(v["result"]["serverInfo"]["name"], "Meshkeep");
    assert_eq!(
        post(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            Some("secret-token"),
            None
        )
        .status(),
        202
    );
    let r = post(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#, Some("secret-token"), None);
    let v: serde_json::Value = r.json().unwrap();
    assert!(v["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "search_projects"));
    assert!(
        !v["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == "update_metadata"),
        "writes are off"
    );
    assert_eq!(post("not json", Some("secret-token"), None).status(), 400);
    assert_eq!(
        client
            .get(&url)
            .header("Authorization", "Bearer secret-token")
            .send()
            .unwrap()
            .status(),
        405
    );
    assert_eq!(client.post(format!("http://127.0.0.1:{port}/other")).send().unwrap().status(), 404);

    // a write through the socket reaches the change callback
    engine
        .lock()
        .unwrap()
        .set_mcp_settings(McpSettings {
            enabled: true,
            token: "secret-token".into(),
            allow_writes: true,
            ..Default::default()
        })
        .unwrap();
    let lib = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(lib.path().join("Vase")).unwrap();
    std::fs::write(lib.path().join("Vase/vase.stl"), b"solid").unwrap();
    let root = engine
        .lock()
        .unwrap()
        .add_root(lib.path(), meshkeep_engine::model::SyncMode::Manual)
        .unwrap();
    engine.lock().unwrap().scan_root(&root.id, |_| {}).unwrap();
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"update_metadata","arguments":{{"project_id":"{}:Vase","creator":"Agent"}}}}}}"#,
        root.id
    );
    let v: serde_json::Value = post(&body, Some("secret-token"), None).json().unwrap();
    assert_eq!(v["result"]["structuredContent"]["creator"], "Agent", "{v}");
    assert_eq!(*seen.lock().unwrap(), 1);
    assert!(host.status(0).requests >= 4);

    // the stdio bridge forwards one line and turns transport trouble into JSON-RPC errors
    let bridge = reqwest::blocking::Client::new();
    let line = meshkeep_lib::mcp_bridge::forward(&bridge, &url, "secret-token", r#"{"jsonrpc":"2.0","id":"a","method":"ping"}"#).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&line).unwrap()["result"],
        serde_json::json!({})
    );
    assert!(!line.contains('\n'), "one line per message");
    assert!(meshkeep_lib::mcp_bridge::forward(
        &bridge,
        &url,
        "secret-token",
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
    )
    .is_none());
    let bad = meshkeep_lib::mcp_bridge::forward(&bridge, &url, "wrong", r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#).unwrap();
    let bad: serde_json::Value = serde_json::from_str(&bad).unwrap();
    assert_eq!(bad["id"], 7);
    assert!(bad["error"]["message"].as_str().unwrap().contains("token"));
    assert!(
        meshkeep_lib::mcp_bridge::forward(&bridge, &url, "wrong", r#"{"jsonrpc":"2.0","method":"notifications/x"}"#).is_none(),
        "no id, no answer"
    );

    host.stop();
    // the accept thread lets go of the port on its own a moment later
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert!(!host.status(7340).running);
    assert!(
        std::net::TcpStream::connect(("127.0.0.1", port)).is_err(),
        "nothing listens after stop"
    );
    let down = meshkeep_lib::mcp_bridge::forward(&bridge, &url, "secret-token", r#"{"jsonrpc":"2.0","id":8,"method":"ping"}"#).unwrap();
    assert!(down.contains("not running"), "{down}");
}
