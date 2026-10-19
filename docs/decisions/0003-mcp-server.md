# ADR-0003: MCP server for agent access to the library

- Status: **proposed** 2026-10-19
- Date: 2026-10-19
- Related: ADR-0001 (shell: Tauri 2 + Rust engine), spec APP-11 (Store readiness),
  APP-12 (this feature), `AGENTS.md` rules 1, 2, 4 and 8.

## Context

Coding and desktop agents (Claude Code, Claude Desktop, IDE agents) talk to local tools
through the Model Context Protocol (MCP). Meshkeep holds a searchable index of a user's
3D-printing library (projects, files, tags, notes, favorites, thumbnails) that such an
agent could use: "find my calibration cubes", "tag everything in `Downloads/` as
`unsorted`", "which projects have no notes". The question was whether the chosen stack
puts a technical limit on offering an MCP server from inside the app.

It does not. Tauri hosts an ordinary Rust process with a tokio runtime, and the engine
(`crates/engine`) is shell-agnostic by design, which is exactly what a second front end
needs. The official Rust SDK (`rmcp`, `modelcontextprotocol/rust-sdk`, 3.x) implements
both MCP transports, stdio and Streamable HTTP, including the server side of Streamable
HTTP on axum. What remains are design constraints, listed here because they decide the
process model and are hard to change later.

### Constraints that shape the design

| # | Constraint | Where it comes from | Effect |
|---|---|---|---|
| C1 | A separate MCP process would open the same `index.sqlite`, start its own watchers and scan in parallel with the app. WAL mode is on, but the index is treated as single-writer, there is no `busy_timeout`, and the watcher loop lives in the shell. | `crates/engine/src/index.rs`, `src-tauri/src/state.rs` | The MCP server should run inside the app process and share the one `Mutex<Engine>`. |
| C2 | Mac App Store builds run in the App Sandbox: a listening socket needs the `com.apple.security.network.server` entitlement, and security-scoped bookmarks for library roots are only valid in the app process. | spec `04-quality.md`, APP-11 | A standalone stdio process could not even read the library on macOS. In-app is the only Store-compatible option there. |
| C3 | MSIX: a full-trust desktop package may listen on loopback (the AppContainer loopback restriction does not apply), but an MCP client can only spawn `meshkeep.exe` by name if the package declares an `AppExecutionAlias`. | APP-11, Windows packaging docs | stdio launch of the app itself is awkward in Store builds; a loopback HTTP endpoint is not. |
| C4 | Rule 4: the frontend never touches the file system; rule 8: deletes go to the trash and only after a confirmation in the UI. | `AGENTS.md` | Unaffected by MCP as long as tools call the engine, not the webview. Delete is not exposed in v1. |
| C5 | Rule 1 and 2: scanning never writes; sidecar writes are atomic and conflict-checked with `sidecar_stamp`. | `AGENTS.md`, spec META-1..4 | A metadata tool must read, then write with the stamp it read, and surface `sidecar_conflict` as a tool error. The watcher keeps the UI in sync, the write looks like an external edit. |
| C6 | Thumbnails are rendered in the webview (Three.js in Web Workers), the engine only stores and keys the PNG cache. | `AGENTS.md` rule 6 and 9 | An MCP tool can serve cached thumbnails only. It cannot render new ones, and a headless process could not render at all. |
| C7 | The engine is synchronous behind one mutex; a root scan holds it for seconds. | `src-tauri/src/commands.rs` uses `spawn_blocking` | Tool handlers run on blocking threads like the Tauri commands; `scan_root` is not exposed as a tool. |
| C8 | Anything listening on loopback is reachable by every local process and, through DNS rebinding, by web pages unless the `Origin` header is checked. | MCP spec, security best practices | Bind `127.0.0.1` only, require a bearer token, validate `Origin`, off by default. |

## Options considered

### A. stdio server as a second process (`meshkeep --mcp`)

The client spawns the app binary in a headless mode that opens the engine directly. This
is how most local MCP servers ship, and it needs no port or token. It fails C1 (two
engines on one index and two watcher sets), C2 (no bookmarks, no library access in the
sandbox), C3 (needs an alias in MSIX) and C6 (no thumbnails). Rejected as the primary
transport.

### B. Streamable HTTP server inside the running app, loopback only

An axum server started from Tauri's `setup`, sharing `AppState`, serving `/mcp` on
`127.0.0.1:<port>` with a bearer token. Satisfies C1 to C8. Clients that speak Streamable
HTTP (Claude Code via `claude mcp add --transport http`, most IDE agents) connect
directly. Cost: the app must be running, and the user has to copy a URL and a token into
the client configuration once.

### C. B plus a thin stdio shim (`meshkeep --mcp-stdio`)

For clients that can only spawn a command or cannot send a static `Authorization`
header (Claude Desktop's custom connectors expect OAuth, not a bearer token; to be
verified at implementation time), a shim mode that reads the token from app data and
forwards stdio to the loopback server. It holds no engine and touches no library file,
so C1, C2 and C6 do not apply; C3 remains (alias in the MSIX manifest). Store review of
a second launch mode is a small, known cost.

### D. External sidecar binary reading the index read-only

A separate crate that opens `index.sqlite` read-only and offers search only. Avoids the
app dependency but duplicates the model, cannot write metadata, has the same sandbox
problem as A on macOS, and drifts from the app's schema. Rejected.

## Decision

**Option B now, option C as the second step of the same backlog item.** Concretely:

1. **Crate layout.** New crate `crates/mcp` (`meshkeep-mcp`) depending on
   `meshkeep-engine` and `rmcp` (features `server`,
   `transport-streamable-http-server`). It defines the tool handlers over an
   `Arc<Mutex<Engine>>` and has no Tauri imports, so `cargo test` can drive it with an
   in-process rmcp client against the fixture library. The shell only starts and stops
   the server and provides the mutex it already owns.
2. **Transport.** Streamable HTTP on `127.0.0.1` at a fixed default port (chosen at
   implementation time, configurable in Settings), path `/mcp`. The server is **off by
   default**; a toggle in Settings starts it. Test mode accepts `MESHKEEP_MCP_PORT` and
   `MESHKEEP_MCP_TOKEN` so E2E tests can connect deterministically.
3. **Authentication.** A random bearer token is generated when the server is first
   enabled and stored in app data. Settings shows the token with a copy button and a
   ready-made configuration snippet per client. Every request must carry it; `Origin`,
   when present, must be a loopback origin; anything else is 403.
4. **Tool surface v1** (names final, parameters mirror the existing command structs so
   `src/lib/types.ts` and the Rust models stay the single source of truth):

   | Tool | Engine call | Notes |
   |---|---|---|
   | `list_roots` | `roots` | includes offline state |
   | `list_projects` | `list_projects(ListQuery)` | root, folder, tags, favorite, sort, limit/offset |
   | `search_projects` | `list_projects` with FTS5 query | same shape, text query required |
   | `get_project` | `get_project` | files, sidecar metadata, slicer badge |
   | `tag_counts` | `tag_counts` | |
   | `library_stats` | `count`, `favorite_count` | |
   | `get_thumbnail` | `thumbnail_path` | returns an MCP image content block from the cache; "not rendered yet" is a normal result, not an error (C6) |
   | `update_metadata` | `get_project` then `update_metadata` with the stamp just read | conflict surfaces as a tool error with both versions (C5) |
   | `set_favorite` | `set_favorite` | |

   Not exposed in v1: `delete_project`, `delete_file` (rule 8), `rename_project`,
   `add_root`, `remove_root`, `scan_root` (C7), raw file bytes (`read_project_file`;
   size and purpose unclear for an agent). Each of these, if ever added, gets its own
   backlog item; a delete tool must block on a confirmation dialog in the app window.
5. **Logging.** Every tool call is logged at info level with tool name and project id,
   every write at the same level as UI writes (spec: "every write to the library is
   logged").
6. **Step two: stdio shim** (`meshkeep --mcp-stdio`) that forwards to the loopback
   server using the stored token, with a clear error when the app is not running, plus
   the `AppExecutionAlias` in the MSIX manifest. Done as part of the same backlog item
   after step one ships, so the Claude Desktop path is covered.

## Consequences

- New dependencies: `rmcp`, `axum`, `tokio` (already transitively present via Tauri).
  The PR adding them states why, per `AGENTS.md`.
- The engine gains a second consumer. Changes to command structs must keep both the
  Tauri commands and the MCP tools compiling; this is the point at which `tauri-specta`
  type generation (Q23) pays off and should be done in the same change or before.
- Store builds need the macOS `network.server` entitlement and the MSIX alias; both go
  on the APP-11 checklist.
- The feature is verifiable at two levels: engine-level tests in `crates/mcp` with an
  in-process client, and one real-app E2E test that starts the app in test mode, connects
  with the official TypeScript MCP client and calls `list_projects` against
  `fixtures/library`.
- `AGENTS.md` gets a line in "Where things are" for `crates/mcp` and a rule 10: MCP
  tools call the engine only, never the webview, and expose no destructive operation
  without a confirmation in the app window.

## Sources consulted (Oct 2026)

- MCP specification, transports (stdio, Streamable HTTP) and security best practices
  (bind localhost, validate `Origin`, authenticate local servers).
- `rmcp` 3.5.1 on crates.io (`modelcontextprotocol/rust-sdk`): feature flags `server`,
  `transport-io`, `transport-streamable-http-server`.
- Apple App Sandbox entitlements: `com.apple.security.network.server` for incoming
  connections; security-scoped bookmarks are per app.
- Windows MSIX: `uap5:AppExecutionAlias` for launching a packaged exe by name; loopback
  restrictions apply to AppContainer apps, not full-trust desktop packages.
- Claude Code: `claude mcp add --transport http <name> <url> --header "Authorization: Bearer …"`.
