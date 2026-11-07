//! The MCP server's brain (ADR-0004): JSON-RPC messages in, results out. Transport, token
//! check and threading live in the shell; this module only knows the engine, so every tool
//! is testable without a socket. Protocol: MCP 2025-06-18, tools and prompts, no resources,
//! stateless (no session ids, no server-initiated messages).
//!
//! Tools come in two sets. Reading ones are always on. Writing ones (metadata, imports,
//! renames, moves, favorites, collections) only exist while "allow writes" is on; a client
//! that listed tools before the switch flipped gets a clear error, not a silent no-op.
//! Nothing here deletes files.

use crate::engine::{BatchUpdate, PromoteItem, UpdateMetadata};
use crate::error::EngineError;
use crate::import::{ArchivePolicy, ImportAction, ImportRequest, ImportRequestItem};
use crate::model::{FileKind, ListQuery, MissingField, Project, SortKey};
use crate::Engine;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_TEXT_BYTES: u64 = 256 << 10;
const MAX_LIST: usize = 200;
const MAX_FOLDER_ENTRIES: usize = 500;

/// Something a tool changed, so the shell can tell the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Library { root_id: Option<String>, reason: String },
    Project(String),
}

/// What one JSON-RPC message produced: a response (none for notifications) and the changes
/// made on the way.
#[derive(Debug, Default)]
pub struct Outcome {
    pub response: Option<Value>,
    pub changes: Vec<Change>,
}

/// The server's self-description for `initialize`.
pub fn server_info() -> Value {
    json!({ "name": "Meshkeep", "version": env!("CARGO_PKG_VERSION") })
}

const INSTRUCTIONS: &str = "Meshkeep is a local library of 3D-print projects (folders with model files and a project.yaml of metadata). \
Use search_projects with `missing` to find projects that lack creator, license, tags, description or a source link; get_project shows files, \
existing metadata and hints read from file names, readmes and shortcuts; read_project_file reads a readme; fetch_model_page reads the project's \
model page when the user allowed it. update_metadata writes project.yaml (only when writes are allowed). list_import_folder and analyze_import \
look at the folders the user opened for imports (downloads); execute_import creates projects from them. Prefer values you can back with a \
hint, a readme or a model page; leave a field alone rather than guess. Nothing here deletes files.";

/// Handles one message or a batch. Batches get a batch back; a batch of notifications gets
/// no response at all.
pub fn handle(engine: &mut Engine, message: &Value) -> Outcome {
    match message {
        Value::Array(items) => {
            let mut out = Outcome::default();
            let mut responses = Vec::new();
            if items.is_empty() {
                out.response = Some(error_response(Value::Null, -32600, "empty batch"));
                return out;
            }
            for item in items {
                let one = handle_one(engine, item);
                if let Some(r) = one.response {
                    responses.push(r);
                }
                out.changes.extend(one.changes);
            }
            if !responses.is_empty() {
                out.response = Some(Value::Array(responses));
            }
            out
        }
        other => handle_one(engine, other),
    }
}

fn handle_one(engine: &mut Engine, message: &Value) -> Outcome {
    let id = message.get("id").cloned().filter(|v| !v.is_null());
    let Some(method) = message.get("method").and_then(|m| m.as_str()) else {
        return Outcome {
            response: Some(error_response(id.unwrap_or(Value::Null), -32600, "not a request: no method")),
            changes: Vec::new(),
        };
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    // notifications carry no id and get no answer
    if method.starts_with("notifications/") {
        return Outcome::default();
    }
    let Some(id) = id else {
        return Outcome::default();
    };
    let mut changes = Vec::new();
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false }, "prompts": { "listChanged": false } },
            "serverInfo": server_info(),
            "instructions": INSTRUCTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools(engine.mcp_settings().allow_writes) })),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Ok(match call_tool(engine, name, &args, &mut changes) {
                Ok(v) => {
                    // the spec wants an object here; clients reject a bare array
                    let v = if v.is_object() { v } else { json!({ "result": v }) };
                    json!({
                        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                        "structuredContent": v,
                        "isError": false,
                    })
                }
                Err(ToolError::Unknown(n)) => {
                    return Outcome {
                        response: Some(error_response(id, -32602, &format!("unknown tool: {n}"))),
                        changes,
                    }
                }
                Err(ToolError::Failed(msg)) => json!({ "content": [{ "type": "text", "text": msg }], "isError": true }),
            })
        }
        "prompts/list" => Ok(json!({ "prompts": prompts() })),
        "prompts/get" => prompt(params.get("name").and_then(|n| n.as_str()).unwrap_or(""), params.get("arguments")),
        "resources/list" => Ok(json!({ "resources": [] })),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        _ => Err(format!("method not found: {method}")),
    };
    let response = match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(msg) => error_response(id, -32601, &msg),
    };
    Outcome {
        response: Some(response),
        changes,
    }
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

enum ToolError {
    Unknown(String),
    Failed(String),
}

impl From<EngineError> for ToolError {
    fn from(e: EngineError) -> Self {
        ToolError::Failed(match e {
            EngineError::PageFetchDisabled => "loading model pages is off: the user can turn it on in Settings → Network".into(),
            EngineError::SidecarConflict => "project.yaml changed on disk while this ran; read the project again and retry".into(),
            other => other.to_string(),
        })
    }
}

impl From<String> for ToolError {
    fn from(s: String) -> Self {
        ToolError::Failed(s)
    }
}

type ToolResult = std::result::Result<Value, ToolError>;

// ---- tool catalogue ---------------------------------------------------------------------

fn schema(props: &[(&str, Value)], required: &[&str]) -> Value {
    let mut m = Map::new();
    for (k, v) in props {
        m.insert(k.to_string(), v.clone());
    }
    json!({ "type": "object", "properties": Value::Object(m), "required": required, "additionalProperties": false })
}
fn s(desc: &str) -> Value {
    json!({ "type": "string", "description": desc })
}
fn b(desc: &str) -> Value {
    json!({ "type": "boolean", "description": desc })
}
fn i(desc: &str) -> Value {
    json!({ "type": "integer", "description": desc })
}
fn strings(desc: &str) -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "description": desc })
}
fn tool(name: &str, desc: &str, input: Value, read_only: bool, destructive: bool) -> Value {
    json!({
        "name": name,
        "description": desc,
        "inputSchema": input,
        "annotations": { "readOnlyHint": read_only, "destructiveHint": destructive, "idempotentHint": read_only, "openWorldHint": false },
    })
}

/// The tools a client may call right now.
pub fn tools(allow_writes: bool) -> Vec<Value> {
    let mut t = vec![
        tool("list_roots", "The library folders Meshkeep manages, with their ids and last scan.", schema(&[], &[]), true, false),
        tool("library_stats", "Project count, total size and favorites.", schema(&[], &[]), true, false),
        tool(
            "search_projects",
            "Find projects. All filters combine with AND. Use `missing` to find projects that still lack a field; `text` is a full-text search over title, creator, description, tags and file names. Returns summaries; call get_project for details.",
            schema(
                &[
                    ("text", s("Full-text search terms")),
                    ("root_id", s("Only this library root")),
                    ("folder", s("Only projects at or below this folder, relative to the root")),
                    ("tags", strings("Only projects carrying every one of these tags")),
                    ("creator", s("Exact creator name, case-insensitive")),
                    ("license", s("Exact license identifier, e.g. CC-BY-4.0")),
                    ("favorites", b("Only favorites")),
                    ("missing", json!({ "type": "array", "items": { "type": "string", "enum": ["creator", "license", "tags", "description", "source_url"] }, "description": "Only projects lacking every listed field" })),
                    ("sort", json!({ "type": "string", "enum": ["modified", "title", "creator", "size", "added"], "description": "Sort order (default modified)" })),
                    ("limit", i("Page size, 1..200 (default 50)")),
                    ("offset", i("Skip this many results")),
                ],
                &[],
            ),
            true,
            false,
        ),
        tool(
            "get_project",
            "Everything about one project: metadata, files, the folder path, hints read from file names, readmes and shortcuts, and the model page link if one is known.",
            schema(&[("project_id", s("Project id from search_projects"))], &["project_id"]),
            true,
            false,
        ),
        tool(
            "read_project_file",
            "The text of a file inside a project (a readme, a license note, a .url shortcut). Text files up to 256 KiB.",
            schema(&[("project_id", s("Project id")), ("rel_path", s("Path of the file relative to the project folder"))], &["project_id", "rel_path"]),
            true,
            false,
        ),
        tool(
            "fetch_model_page",
            "Read a model page (Printables, Thingiverse, MakerWorld, Thangs) and return the title, creator, license, description and tags it states. Pass a project_id to use the project's own link, or a url. Only works when the user turned on \"Load model pages\" in Settings.",
            schema(&[("project_id", s("Use the project's source link or shortcut")), ("url", s("A model page URL on a supported site"))], &[]),
            true,
            false,
        ),
        tool(
            "creator_suggestions",
            "Creators Meshkeep can propose for projects without one, grouped by creator with the evidence per project.",
            schema(&[], &[]),
            true,
            false,
        ),
        tool("list_inbox", "Loose files in a root's _Inbox folder, waiting to become projects.", schema(&[("root_id", s("Library root id"))], &["root_id"]), true, false),
        tool(
            "list_import_folder",
            "List a folder the user opened for imports (their downloads, by default the first one configured). Non-recursive; archives, model files and folders are what analyze_import takes.",
            schema(&[("path", s("Folder to list; must be one of the configured import folders or inside one. Omit for the first configured folder."))], &[]),
            true,
            false,
        ),
        tool(
            "analyze_import",
            "What importing these paths would create: for each archive, folder or file the proposed name, action, model count and hints (creator, license, link) found in names and readmes. Paths must lie inside the configured import folders.",
            schema(&[("paths", strings("Absolute paths of archives, folders or files"))], &["paths"]),
            true,
            false,
        ),
        tool(
            "find_duplicates",
            "Projects sharing identical model files (by content). Hashes files on first use, so this can take a while on a large library.",
            schema(&[], &[]),
            true,
            false,
        ),
        tool("list_collections", "Manual collections and how many projects each holds.", schema(&[], &[]), true, false),
        tool(
            "scan_root",
            "Rescan a library root so the index reflects the disk (after files changed outside the app).",
            schema(&[("root_id", s("Library root id"))], &["root_id"]),
            true,
            false,
        ),
    ];
    if allow_writes {
        t.extend([
            tool(
                "update_metadata",
                "Write metadata into a project's project.yaml. Only the fields you pass change; an empty string clears a field. `tags` replaces the tag list, `add_tags`/`remove_tags` adjust it. Tags are lowercase words.",
                schema(
                    &[
                        ("project_id", s("Project id")),
                        ("title", s("Display title")),
                        ("creator", s("Designer or brand")),
                        ("license", s("License identifier, e.g. CC-BY-NC-SA-4.0, CC0-1.0, MIT, Personal use")),
                        ("source_url", s("The model's web page")),
                        ("description", s("A short description")),
                        ("tags", strings("Replace all tags")),
                        ("add_tags", strings("Tags to add")),
                        ("remove_tags", strings("Tags to remove")),
                        ("recommended_material", s("e.g. PLA, PETG")),
                        ("supports_required", b("Whether printing needs supports")),
                        ("notes", s("Printing notes")),
                    ],
                    &["project_id"],
                ),
                false,
                false,
            ),
            tool(
                "batch_update",
                "The same change on many projects: add or remove tags, set creator or license (empty string clears).",
                schema(
                    &[
                        ("project_ids", strings("Project ids")),
                        ("add_tags", strings("Tags to add")),
                        ("remove_tags", strings("Tags to remove")),
                        ("creator", s("Set the creator")),
                        ("license", s("Set the license")),
                    ],
                    &["project_ids"],
                ),
                false,
                false,
            ),
            tool(
                "execute_import",
                "Create projects from archives, folders or files in the import folders (see analyze_import for the items). Each item: source path, action (project | inbox | skip) and the project name. A zip or 7z is extracted into the new project folder; a folder is copied; a loose model file (stl, 3mf, obj, ...) is copied into the new folder as it is, never extracted. A failed item leaves nothing behind. With apply_hints the creator, license and link found in the files are written into each new project.yaml; with fetch_pages the model page is read too (needs the network setting). archive_policy applies to zip and 7z only, never to model files: keep (copy the archive into the project), originals (move it to <root>/_Originals), trash, or leave (leave it where it is).",
                schema(
                    &[
                        ("root_id", s("Library root that receives the projects")),
                        ("items", json!({ "type": "array", "items": { "type": "object", "properties": { "source": { "type": "string" }, "action": { "type": "string", "enum": ["project", "inbox", "skip"] }, "name": { "type": "string" } }, "required": ["source", "action"] }, "description": "What to import" })),
                        ("archive_policy", json!({ "type": "string", "enum": ["keep", "originals", "trash", "leave"], "description": "What happens to archives after extraction (default leave)" })),
                        ("apply_hints", b("Write detected creator, license and link into the new projects (default true)")),
                        ("fetch_pages", b("Also read each new project's model page (default false)")),
                    ],
                    &["root_id", "items"],
                ),
                false,
                false,
            ),
            tool(
                "promote_inbox",
                "Turn inbox files into projects, each with its own name.",
                schema(
                    &[
                        ("root_id", s("Library root id")),
                        ("items", json!({ "type": "array", "items": { "type": "object", "properties": { "file": { "type": "string" }, "name": { "type": "string" } }, "required": ["file", "name"] }, "description": "Inbox file name and the project name it becomes" })),
                    ],
                    &["root_id", "items"],
                ),
                false,
                false,
            ),
            tool(
                "rename_project",
                "Rename a project's folder. Metadata, favorites and collections follow it; the id changes.",
                schema(&[("project_id", s("Project id")), ("new_name", s("New folder name"))], &["project_id", "new_name"]),
                false,
                false,
            ),
            tool(
                "move_projects",
                "Move projects into another folder of a library (created when missing). Ids change.",
                schema(
                    &[("project_ids", strings("Project ids")), ("dest_root", s("Target library root id")), ("dest_rel", s("Target folder relative to the root, empty for the root itself"))],
                    &["project_ids", "dest_root"],
                ),
                false,
                false,
            ),
            tool(
                "set_favorite",
                "Mark or unmark a project as favorite.",
                schema(&[("project_id", s("Project id")), ("favorite", b("true to mark"))], &["project_id", "favorite"]),
                false,
                false,
            ),
            tool(
                "add_to_collection",
                "Add projects to a manual collection, by id or by name (a new collection is created for an unknown name).",
                schema(
                    &[("project_ids", strings("Project ids")), ("collection_id", s("Existing collection id")), ("name", s("Collection name, used when no id is given"))],
                    &["project_ids"],
                ),
                false,
                false,
            ),
        ]);
    }
    t
}

fn prompts() -> Vec<Value> {
    vec![json!({
        "name": "enrich_library",
        "description": "Fill in missing creator, license, tags and descriptions across the library, with evidence from files and model pages.",
        "arguments": [
            { "name": "scope", "description": "Optional: a root id, folder or search text to limit the work", "required": false },
            { "name": "fields", "description": "Optional: which fields to fill (default: creator, license, tags, source_url)", "required": false }
        ]
    })]
}

fn prompt(name: &str, args: Option<&Value>) -> std::result::Result<Value, String> {
    if name != "enrich_library" {
        return Err(format!("unknown prompt: {name}"));
    }
    let scope = args
        .and_then(|a| a.get("scope"))
        .and_then(|v| v.as_str())
        .unwrap_or("the whole library");
    let fields = args
        .and_then(|a| a.get("fields"))
        .and_then(|v| v.as_str())
        .unwrap_or("creator, license, tags, source_url");
    let text = format!(
        "Enrich the metadata of the 3D-print projects in Meshkeep. Scope: {scope}. Fields: {fields}.\n\n\
Work project by project:\n\
1. search_projects with `missing` for the fields, in pages of 50.\n\
2. For each project, get_project: look at the hints (creator, license, link with confidence and source), the file names and the files. Read a readme with read_project_file when one exists.\n\
3. When a model page link is known (hints or source_url) and fetch_model_page works, read it: its creator, license, tags and description are the best evidence.\n\
4. Write only values you can back with evidence from the files or the page (update_metadata). Keep tags short, lowercase, reuse tags the library already has (search_projects shows them). Leave a field empty rather than guess.\n\
5. Report at the end what you filled, what you left open and why."
    );
    Ok(
        json!({ "description": "Fill missing metadata with evidence", "messages": [{ "role": "user", "content": { "type": "text", "text": text } }] }),
    )
}

// ---- argument helpers -------------------------------------------------------------------

fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}
fn need_str(args: &Value, key: &str) -> std::result::Result<String, ToolError> {
    arg_str(args, key)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| ToolError::Failed(format!("missing argument: {key}")))
}
fn arg_strings(args: &Value, key: &str) -> Option<Vec<String>> {
    args.get(key)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
}
fn arg_bool(args: &Value, key: &str) -> Option<bool> {
    args.get(key).and_then(|v| v.as_bool())
}

// ---- tools --------------------------------------------------------------------------------

fn call_tool(engine: &mut Engine, name: &str, args: &Value, changes: &mut Vec<Change>) -> ToolResult {
    let writes = engine.mcp_settings().allow_writes;
    let is_write = matches!(
        name,
        "update_metadata"
            | "batch_update"
            | "execute_import"
            | "promote_inbox"
            | "rename_project"
            | "move_projects"
            | "set_favorite"
            | "add_to_collection"
    );
    if is_write && !writes {
        return Err(ToolError::Failed(format!(
            "{name} is not available: writes are off. The user can allow them in Settings → MCP server."
        )));
    }
    match name {
        "list_roots" => {
            let roots = engine.roots()?;
            Ok(json!({ "roots": roots
                .iter()
                .map(|r| json!({
                    "id": r.id, "path": r.path, "mode": r.mode, "status": r.status,
                    "last_scan_at": r.last_scan_at.map(|t| t.format(&time::format_description::well_known::Rfc3339).unwrap_or_default()),
                    "projects": r.last_scan.as_ref().map(|s| s.projects),
                }))
                .collect::<Vec<_>>() }))
        }
        "library_stats" => {
            let (projects, bytes) = engine.count(None)?;
            Ok(json!({ "projects": projects, "total_bytes": bytes, "favorites": engine.favorite_count()? }))
        }
        "search_projects" => {
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|l| l.clamp(1, MAX_LIST as u64))
                .unwrap_or(50) as u32;
            let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let missing = arg_strings(args, "missing")
                .unwrap_or_default()
                .iter()
                .filter_map(|m| serde_json::from_value::<MissingField>(Value::String(m.clone())).ok())
                .collect();
            let sort = arg_str(args, "sort")
                .and_then(|v| serde_json::from_value::<SortKey>(Value::String(v)).ok())
                .unwrap_or_default();
            let q = ListQuery {
                root_id: arg_str(args, "root_id"),
                path_prefix: arg_str(args, "folder"),
                tags: arg_strings(args, "tags").unwrap_or_default(),
                text: arg_str(args, "text"),
                favorites: arg_bool(args, "favorites").unwrap_or(false),
                collection_id: None,
                creator: arg_str(args, "creator"),
                license: arg_str(args, "license"),
                material: None,
                file_type: None,
                missing,
                sort,
                limit: Some(limit),
                offset: Some(offset),
            };
            let items = engine.list_projects(&q)?;
            let more = items.len() as u32 == limit;
            Ok(json!({
                "projects": items.iter().map(|p| json!({
                    "id": p.id, "title": p.title, "root_id": p.root_id, "rel_path": p.rel_path, "creator": p.creator, "tags": p.tags,
                    "model_count": p.model_count, "file_count": p.file_count, "total_bytes": p.total_bytes, "has_sidecar": p.has_sidecar,
                    "favorite": p.favorite, "offline": p.offline,
                })).collect::<Vec<_>>(),
                "next_offset": if more { Some(offset + limit) } else { None },
            }))
        }
        "get_project" => {
            let id = need_str(args, "project_id")?;
            let p = engine.get_project(&id)?;
            let mut v = project_view(engine, &p);
            if let Ok(h) = engine.project_hints(&id) {
                v["hints"] = json!({
                    "creator": h.creator.iter().map(hint_view).collect::<Vec<_>>(),
                    "license": h.license.iter().map(hint_view).collect::<Vec<_>>(),
                    "source_url": h.source_url.iter().map(hint_view).collect::<Vec<_>>(),
                });
            }
            v["model_page_url"] = json!(engine.model_page_url(&id).ok().flatten());
            Ok(v)
        }
        "read_project_file" => {
            let id = need_str(args, "project_id")?;
            let rel = need_str(args, "rel_path")?;
            let path = engine.resolve_file(&id, &rel)?;
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if meta.len() > MAX_TEXT_BYTES {
                return Err(format!(
                    "{rel} is {} bytes; only text files up to {} bytes are read",
                    meta.len(),
                    MAX_TEXT_BYTES
                )
                .into());
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            if bytes.iter().take(4096).filter(|b| **b == 0).count() > 0 {
                return Err(format!("{rel} is not a text file").into());
            }
            Ok(json!({ "rel_path": rel, "text": String::from_utf8_lossy(&bytes) }))
        }
        "fetch_model_page" => {
            let s = match (arg_str(args, "project_id"), arg_str(args, "url")) {
                (Some(id), _) => engine.fetch_model_page(&id)?,
                (None, Some(url)) => engine.fetch_page(&url)?,
                (None, None) => return Err("pass project_id or url".to_string().into()),
            };
            Ok(serde_json::to_value(s).unwrap_or_default())
        }
        "creator_suggestions" => Ok(serde_json::to_value(engine.creator_suggestions()?).unwrap_or_default()),
        "list_inbox" => {
            let root = need_str(args, "root_id")?;
            Ok(json!({ "files": engine.list_inbox(&root)? }))
        }
        "list_import_folder" => {
            let dirs = engine.mcp_settings().import_dirs;
            let dir = match arg_str(args, "path") {
                Some(p) => allowed_path(&dirs, Path::new(&p))?,
                None => dirs.first().cloned().ok_or_else(|| ToolError::Failed(NO_IMPORT_DIRS.into()))?,
            };
            Ok(json!({ "path": dir, "entries": list_folder(&dir)? }))
        }
        "analyze_import" => {
            let dirs = engine.mcp_settings().import_dirs;
            let paths = arg_strings(args, "paths").unwrap_or_default();
            if paths.is_empty() {
                return Err("pass at least one path".to_string().into());
            }
            let mut checked = Vec::new();
            for p in &paths {
                checked.push(allowed_path(&dirs, Path::new(p))?);
            }
            Ok(json!({ "items": engine.analyze_import(&checked) }))
        }
        "find_duplicates" => {
            let r = engine.find_duplicates(|_| {})?;
            Ok(json!({
                "candidates": r.candidates, "hashed": r.hashed,
                "groups": r.groups.iter().map(|g| json!({
                    "kind": g.kind, "files": g.files, "bytes": g.bytes,
                    "members": g.members.iter().map(|m| json!({ "id": m.project.id, "title": m.project.title, "rel_path": m.project.rel_path, "shared_files": m.shared_files, "model_files": m.model_files, "covers": m.covers })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }))
        }
        "list_collections" => Ok(json!({ "collections": engine
            .collections()
            .iter()
            .map(|c| json!({ "id": c.id, "name": c.name, "projects": c.projects.len() }))
            .collect::<Vec<_>>() })),
        "scan_root" => {
            let root = need_str(args, "root_id")?;
            let r = engine.scan_root_as(&root, "mcp", |_| {})?;
            changes.push(Change::Library {
                root_id: Some(root),
                reason: "scan".into(),
            });
            Ok(serde_json::to_value(r).unwrap_or_default())
        }
        "update_metadata" => {
            let id = need_str(args, "project_id")?;
            let p = engine.get_project(&id)?;
            let tags = match (
                arg_strings(args, "tags"),
                arg_strings(args, "add_tags"),
                arg_strings(args, "remove_tags"),
            ) {
                (Some(t), _, _) => Some(t),
                (None, None, None) => None,
                (None, add, remove) => {
                    let mut t = p.tags.clone();
                    t.extend(add.unwrap_or_default());
                    let remove: Vec<String> = remove.unwrap_or_default().iter().map(|r| r.trim().to_lowercase()).collect();
                    t.retain(|x| !remove.contains(&x.trim().to_lowercase()));
                    Some(t)
                }
            };
            let upd = UpdateMetadata {
                title: arg_str(args, "title"),
                creator: arg_str(args, "creator"),
                license: arg_str(args, "license"),
                source_url: arg_str(args, "source_url"),
                description: arg_str(args, "description"),
                tags,
                recommended_material: arg_str(args, "recommended_material"),
                supports_required: arg_bool(args, "supports_required"),
                notes: arg_str(args, "notes"),
                expected_stamp: p.sidecar_stamp,
                force: false,
            };
            let p = engine.update_metadata(&id, upd)?;
            changes.push(Change::Project(id));
            Ok(project_view(engine, &p))
        }
        "batch_update" => {
            let ids = arg_strings(args, "project_ids").unwrap_or_default();
            let upd = BatchUpdate {
                add_tags: arg_strings(args, "add_tags").unwrap_or_default(),
                remove_tags: arg_strings(args, "remove_tags").unwrap_or_default(),
                creator: arg_str(args, "creator"),
                license: arg_str(args, "license"),
            };
            let r = engine.batch_update_metadata(&ids, &upd)?;
            for id in &ids {
                changes.push(Change::Project(id.clone()));
            }
            Ok(serde_json::to_value(r).unwrap_or_default())
        }
        "execute_import" => {
            let dirs = engine.mcp_settings().import_dirs;
            let root_id = need_str(args, "root_id")?;
            let mut items = Vec::new();
            for it in args.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                let source = allowed_path(&dirs, Path::new(&need_str(&it, "source")?))?;
                let action = match arg_str(&it, "action").as_deref() {
                    Some("project") => ImportAction::Project,
                    Some("inbox") => ImportAction::Inbox,
                    Some("skip") => ImportAction::Skip,
                    other => return Err(format!("unknown action {other:?}; use project, inbox or skip").into()),
                };
                let name = arg_str(&it, "name")
                    .unwrap_or_else(|| source.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
                items.push(ImportRequestItem { source, action, name });
            }
            if items.is_empty() {
                return Err("pass at least one item".to_string().into());
            }
            let archive_policy = match arg_str(args, "archive_policy").as_deref() {
                Some("keep") => ArchivePolicy::Keep,
                Some("originals") => ArchivePolicy::Originals,
                Some("trash") => ArchivePolicy::Trash,
                None | Some("leave") => ArchivePolicy::Leave,
                Some(other) => return Err(format!("unknown archive_policy {other}").into()),
            };
            let req = ImportRequest {
                root_id: root_id.clone(),
                items,
                archive_policy,
                apply_hints: arg_bool(args, "apply_hints").unwrap_or(true),
                fetch_pages: arg_bool(args, "fetch_pages").unwrap_or(false),
            };
            let r = engine.execute_import(&req, |_| {})?;
            changes.push(Change::Library {
                root_id: Some(root_id),
                reason: "import".into(),
            });
            Ok(serde_json::to_value(r).unwrap_or_default())
        }
        "promote_inbox" => {
            let root_id = need_str(args, "root_id")?;
            let items: Vec<PromoteItem> = args
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|it| {
                    Ok(PromoteItem {
                        file: need_str(it, "file")?,
                        name: need_str(it, "name")?,
                    })
                })
                .collect::<std::result::Result<_, ToolError>>()?;
            let r = engine.promote_inbox_each(&root_id, &items)?;
            changes.push(Change::Library {
                root_id: Some(root_id),
                reason: "promote".into(),
            });
            Ok(json!({
                "created": r.created.iter().map(|p| json!({ "id": p.id, "title": p.title, "rel_path": p.rel_path })).collect::<Vec<_>>(),
                "failed": r.failed,
            }))
        }
        "rename_project" => {
            let id = need_str(args, "project_id")?;
            let p = engine.rename_project(&id, &need_str(args, "new_name")?)?;
            changes.push(Change::Library {
                root_id: Some(p.root_id.clone()),
                reason: "rename".into(),
            });
            Ok(project_view(engine, &p))
        }
        "move_projects" => {
            let ids = arg_strings(args, "project_ids").unwrap_or_default();
            let dest_root = need_str(args, "dest_root")?;
            let r = engine.move_projects(&ids, &dest_root, arg_str(args, "dest_rel").unwrap_or_default().trim())?;
            changes.push(Change::Library {
                root_id: None,
                reason: "move".into(),
            });
            Ok(json!({
                "moved": r.moved.iter().map(|p| json!({ "id": p.id, "title": p.title, "rel_path": p.rel_path, "root_id": p.root_id })).collect::<Vec<_>>(),
                "failed": r.failed,
            }))
        }
        "set_favorite" => {
            let id = need_str(args, "project_id")?;
            let fav = arg_bool(args, "favorite").ok_or_else(|| ToolError::Failed("missing argument: favorite".into()))?;
            let p = engine.set_favorite(&id, fav)?;
            changes.push(Change::Project(id));
            Ok(json!({ "id": p.id, "favorite": p.favorite }))
        }
        "add_to_collection" => {
            let ids = arg_strings(args, "project_ids").unwrap_or_default();
            let cid = match (arg_str(args, "collection_id"), arg_str(args, "name")) {
                (Some(id), _) => id,
                (None, Some(name)) => match engine.collections().iter().find(|c| c.name.eq_ignore_ascii_case(name.trim())) {
                    Some(c) => c.id.clone(),
                    None => engine.create_collection(name.trim())?.id,
                },
                (None, None) => return Err("pass collection_id or name".to_string().into()),
            };
            let c = engine.add_to_collection(&cid, &ids)?;
            changes.push(Change::Library {
                root_id: None,
                reason: "collection".into(),
            });
            Ok(json!({ "id": c.id, "name": c.name, "projects": c.projects.len() }))
        }
        other => Err(ToolError::Unknown(other.to_string())),
    }
}

const NO_IMPORT_DIRS: &str = "no import folders are configured; the user can add one in Settings → MCP server";

fn hint_view(h: &crate::hints::Hint) -> Value {
    json!({ "value": h.value, "source": h.source, "confidence": h.confidence })
}

fn project_view(engine: &Engine, p: &Project) -> Value {
    json!({
        "id": p.id,
        "root_id": p.root_id,
        "rel_path": p.rel_path,
        "folder": engine.project_dir(p).ok(),
        "title": p.title,
        "creator": p.creator,
        "license": p.license,
        "source_url": p.source_url,
        "description": p.description,
        "tags": p.tags,
        "recommended_material": p.material,
        "supports_required": p.supports_required,
        "favorite": p.favorite,
        "sidecar": p.sidecar,
        "offline": p.offline,
        "files": p.files.iter().map(|f| json!({ "rel_path": f.rel_path, "kind": f.kind, "size": f.size })).collect::<Vec<_>>(),
    })
}

/// A path the agent may touch: inside one of the configured import folders, after
/// resolving symlinks, so `..` and links cannot lead elsewhere.
fn allowed_path(dirs: &[PathBuf], path: &Path) -> std::result::Result<PathBuf, ToolError> {
    if dirs.is_empty() {
        return Err(NO_IMPORT_DIRS.to_string().into());
    }
    let real = dunce::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    for d in dirs {
        if let Ok(root) = dunce::canonicalize(d) {
            if real.starts_with(&root) {
                return Ok(real);
            }
        }
    }
    Err(format!("{} is outside the import folders the user allowed", path.display()).into())
}

fn list_folder(dir: &Path) -> std::result::Result<Vec<Value>, ToolError> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut out: Vec<(time::OffsetDateTime, Value)> = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .map(time::OffsetDateTime::from)
            .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
        let kind = if meta.is_dir() {
            "folder"
        } else {
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            match ext.as_str() {
                "zip" | "7z" => "archive",
                "rar" => "archive_unsupported",
                _ => match FileKind::from_extension(&ext) {
                    FileKind::Model => "model",
                    FileKind::Image => "image",
                    _ => "file",
                },
            }
        };
        out.push((
            modified,
            json!({
                "path": entry.path(), "name": name, "kind": kind, "size": if meta.is_dir() { Value::Null } else { json!(meta.len()) },
                "modified": modified.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
            }),
        ));
    }
    out.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    Ok(out.into_iter().take(MAX_FOLDER_ENTRIES).map(|(_, v)| v).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SyncMode;
    use crate::settings::McpSettings;

    fn touch(p: &Path, bytes: usize) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, vec![b'x'; bytes]).unwrap();
    }

    fn call(engine: &mut Engine, id: u64, name: &str, args: Value) -> (Value, Vec<Change>) {
        let out = handle(
            engine,
            &json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": args } }),
        );
        (out.response.unwrap(), out.changes)
    }

    fn structured(v: &Value) -> Value {
        assert_eq!(v["result"]["isError"], false, "{v}");
        let s = v["result"]["structuredContent"].clone();
        assert!(s.is_object(), "structuredContent must be an object (clients reject arrays): {s}");
        s
    }

    #[test]
    fn protocol_basics() {
        let data = tempfile::tempdir().unwrap();
        let mut engine = Engine::open(data.path()).unwrap();
        let init = handle(
            &mut engine,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "t", "version": "0" } } }),
        );
        let r = init.response.unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(r["result"]["serverInfo"]["name"], "Meshkeep");
        assert!(
            handle(&mut engine, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
                .response
                .is_none()
        );
        assert_eq!(
            handle(&mut engine, &json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }))
                .response
                .unwrap()["result"],
            json!({})
        );
        let unknown = handle(&mut engine, &json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" }))
            .response
            .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        let bad = handle(&mut engine, &json!({ "id": 4 })).response.unwrap();
        assert_eq!(bad["error"]["code"], -32600);
        // a batch answers each request and skips notifications
        let batch = handle(
            &mut engine,
            &json!([{ "jsonrpc": "2.0", "id": 5, "method": "ping" }, { "jsonrpc": "2.0", "method": "notifications/x" }]),
        );
        assert_eq!(batch.response.unwrap().as_array().unwrap().len(), 1);
        // prompts
        let p = handle(&mut engine, &json!({ "jsonrpc": "2.0", "id": 6, "method": "prompts/get", "params": { "name": "enrich_library", "arguments": { "scope": "Dragons" } } })).response.unwrap();
        assert!(p["result"]["messages"][0]["content"]["text"]
            .as_str()
            .unwrap()
            .contains("Scope: Dragons"));
        assert_eq!(
            handle(&mut engine, &json!({ "jsonrpc": "2.0", "id": 7, "method": "resources/list" }))
                .response
                .unwrap()["result"]["resources"],
            json!([])
        );
    }

    #[test]
    fn write_tools_follow_the_switch() {
        let data = tempfile::tempdir().unwrap();
        let mut engine = Engine::open(data.path()).unwrap();
        let list = |e: &mut Engine| {
            handle(e, &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
                .response
                .unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .len()
        };
        let read_only = list(&mut engine);
        assert!(read_only >= 13);
        let (r, changes) = call(&mut engine, 2, "update_metadata", json!({ "project_id": "x", "creator": "y" }));
        assert_eq!(r["result"]["isError"], true);
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("writes are off"));
        assert!(changes.is_empty());
        engine
            .set_mcp_settings(McpSettings {
                allow_writes: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(list(&mut engine), read_only + 8);
        let (r, _) = call(&mut engine, 3, "no_such_tool", json!({}));
        assert_eq!(r["error"]["code"], -32602);
    }

    #[test]
    fn search_get_and_update_through_tools() {
        let data = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        touch(&lib.path().join("Rose/Cinderwing3D Baby Rose.stl"), 10);
        std::fs::write(
            lib.path().join("Rose/README.txt"),
            b"Designed by Cinderwing3D\nLicense: CC BY-NC-SA 4.0\nhttps://www.printables.com/model/1234567-baby-rose-dragon\n",
        )
        .unwrap();
        touch(&lib.path().join("Bins/bin.stl"), 10);
        std::fs::write(
            lib.path().join("Bins/project.yaml"),
            b"metadata:\n  creator: Zack\n  tags: [gridfinity]\n",
        )
        .unwrap();
        let mut engine = Engine::open(data.path()).unwrap();
        engine
            .set_mcp_settings(McpSettings {
                enabled: true,
                allow_writes: true,
                ..Default::default()
            })
            .unwrap();
        assert!(engine.mcp_settings().token.starts_with("mk_"), "enabling mints a token");
        let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();

        let (r, _) = call(&mut engine, 1, "list_roots", json!({}));
        assert_eq!(structured(&r)["roots"][0]["id"], root.id);
        let (r, _) = call(&mut engine, 2, "search_projects", json!({ "missing": ["creator"] }));
        let found = structured(&r);
        assert_eq!(found["projects"].as_array().unwrap().len(), 1);
        assert_eq!(found["projects"][0]["rel_path"], "Rose");
        assert!(found["next_offset"].is_null());
        let (r, _) = call(&mut engine, 3, "search_projects", json!({ "tags": ["gridfinity"] }));
        assert_eq!(structured(&r)["projects"][0]["rel_path"], "Bins");
        let (r, _) = call(&mut engine, 4, "search_projects", json!({ "limit": 1 }));
        assert_eq!(structured(&r)["next_offset"], 1);

        let rose = format!("{}:Rose", root.id);
        let (r, _) = call(&mut engine, 5, "get_project", json!({ "project_id": rose }));
        let v = structured(&r);
        assert_eq!(v["hints"]["creator"][0]["value"], "Cinderwing3D");
        assert_eq!(v["hints"]["license"][0]["value"], "CC-BY-NC-SA-4.0");
        assert_eq!(v["model_page_url"], "https://www.printables.com/model/1234567-baby-rose-dragon");
        assert_eq!(v["files"].as_array().unwrap().len(), 2);
        let (r, _) = call(
            &mut engine,
            6,
            "read_project_file",
            json!({ "project_id": rose, "rel_path": "README.txt" }),
        );
        assert!(structured(&r)["text"].as_str().unwrap().contains("Designed by"));
        let (r, _) = call(
            &mut engine,
            7,
            "read_project_file",
            json!({ "project_id": rose, "rel_path": "../Bins/bin.stl" }),
        );
        assert_eq!(r["result"]["isError"], true, "no escaping the project");
        // pages are off until the user says so
        let (r, _) = call(&mut engine, 8, "fetch_model_page", json!({ "project_id": rose }));
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("Settings"));

        let (r, changes) = call(
            &mut engine,
            9,
            "update_metadata",
            json!({ "project_id": rose, "creator": "Cinderwing3D", "license": "CC-BY-NC-SA-4.0", "add_tags": ["Dragon", "articulated"] }),
        );
        let v = structured(&r);
        assert_eq!(v["creator"], "Cinderwing3D");
        assert_eq!(v["tags"], json!(["articulated", "dragon"]));
        assert_eq!(changes, vec![Change::Project(rose.clone())]);
        let (r, _) = call(
            &mut engine,
            10,
            "update_metadata",
            json!({ "project_id": rose, "remove_tags": ["dragon"], "creator": "" }),
        );
        let v = structured(&r);
        assert_eq!(v["tags"], json!(["articulated"]));
        assert!(v["creator"].is_null());
        let text = std::fs::read_to_string(lib.path().join("Rose/project.yaml")).unwrap();
        assert!(text.contains("CC-BY-NC-SA-4.0"), "{text}");
        let (r, _) = call(&mut engine, 11, "search_projects", json!({ "missing": ["creator"] }));
        assert_eq!(
            structured(&r)["projects"].as_array().unwrap().len(),
            1,
            "Rose lost its creator again"
        );

        let (r, _) = call(
            &mut engine,
            12,
            "batch_update",
            json!({ "project_ids": [rose, format!("{}:Bins", root.id)], "add_tags": ["print-in-place"] }),
        );
        assert_eq!(structured(&r)["updated"], 2);
        let (r, _) = call(&mut engine, 13, "set_favorite", json!({ "project_id": rose, "favorite": true }));
        assert_eq!(structured(&r)["favorite"], true);
        let (r, _) = call(
            &mut engine,
            14,
            "add_to_collection",
            json!({ "name": "Dragons", "project_ids": [rose] }),
        );
        assert_eq!(structured(&r)["projects"], 1);
        let (r, _) = call(&mut engine, 15, "list_collections", json!({}));
        assert_eq!(structured(&r)["collections"][0]["name"], "Dragons");
        let (r, _) = call(&mut engine, 16, "library_stats", json!({}));
        assert_eq!(structured(&r)["favorites"], 1);
    }

    #[test]
    fn imports_stay_inside_the_allowed_folders() {
        let data = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        touch(&lib.path().join("Existing/part.stl"), 10);
        touch(&downloads.path().join("Cable Clip/clip.stl"), 10);
        std::fs::write(downloads.path().join("Cable Clip/README.md"), b"by PrintTools\nCC0\n").unwrap();
        touch(&downloads.path().join("hook.stl"), 10);
        touch(&downloads.path().join("notes.txt"), 10);
        touch(&elsewhere.path().join("secret.stl"), 10);
        let mut engine = Engine::open(data.path()).unwrap();
        let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();

        let (r, _) = call(&mut engine, 1, "list_import_folder", json!({}));
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("no import folders"));
        engine
            .set_mcp_settings(McpSettings {
                enabled: true,
                allow_writes: true,
                import_dirs: vec![downloads.path().to_path_buf()],
                ..Default::default()
            })
            .unwrap();
        let (r, _) = call(&mut engine, 2, "list_import_folder", json!({}));
        let v = structured(&r);
        let kinds: Vec<(String, String)> = v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e["name"].as_str().unwrap().to_string(), e["kind"].as_str().unwrap().to_string()))
            .collect();
        assert!(kinds.contains(&("Cable Clip".into(), "folder".into())), "{kinds:?}");
        assert!(kinds.contains(&("hook.stl".into(), "model".into())));
        assert!(kinds.contains(&("notes.txt".into(), "file".into())));
        let (r, _) = call(&mut engine, 3, "list_import_folder", json!({ "path": elsewhere.path() }));
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("outside"));
        let (r, _) = call(
            &mut engine,
            4,
            "analyze_import",
            json!({ "paths": [elsewhere.path().join("secret.stl")] }),
        );
        assert_eq!(r["result"]["isError"], true);

        let clip = downloads.path().join("Cable Clip");
        let (r, _) = call(
            &mut engine,
            5,
            "analyze_import",
            json!({ "paths": [clip, downloads.path().join("hook.stl")] }),
        );
        let items = structured(&r);
        assert_eq!(items["items"][0]["hints"]["creator"], "PrintTools");
        assert_eq!(items["items"][0]["hints"]["license"], "CC0-1.0");
        let (r, changes) = call(
            &mut engine,
            6,
            "execute_import",
            json!({ "root_id": root.id, "items": [{ "source": clip, "action": "project", "name": "Cable Clip" }, { "source": downloads.path().join("hook.stl"), "action": "inbox" }] }),
        );
        let v = structured(&r);
        assert_eq!(v["projects"], json!(["Cable Clip"]));
        assert_eq!(v["inbox_files"], 1);
        assert_eq!(v["metadata_written"], 1, "hints applied by default");
        assert!(matches!(&changes[0], Change::Library { reason, .. } if reason == "import"));
        let (r, _) = call(
            &mut engine,
            7,
            "get_project",
            json!({ "project_id": format!("{}:Cable Clip", root.id) }),
        );
        assert_eq!(structured(&r)["creator"], "PrintTools");
        let (r, _) = call(&mut engine, 8, "list_inbox", json!({ "root_id": root.id }));
        assert_eq!(structured(&r)["files"][0]["name"], "hook.stl");
        let (r, _) = call(
            &mut engine,
            9,
            "promote_inbox",
            json!({ "root_id": root.id, "items": [{ "file": "hook.stl", "name": "Hook" }] }),
        );
        assert_eq!(structured(&r)["created"][0]["rel_path"], "Hook");
        let (r, _) = call(
            &mut engine,
            10,
            "rename_project",
            json!({ "project_id": format!("{}:Hook", root.id), "new_name": "Wall Hook" }),
        );
        assert_eq!(structured(&r)["rel_path"], "Wall Hook");
        let (r, _) = call(
            &mut engine,
            11,
            "move_projects",
            json!({ "project_ids": [format!("{}:Wall Hook", root.id)], "dest_root": root.id, "dest_rel": "Hooks" }),
        );
        assert_eq!(structured(&r)["moved"][0]["rel_path"], "Hooks/Wall Hook");
        assert!(lib.path().join("Hooks/Wall Hook/hook.stl").is_file());
    }
}
