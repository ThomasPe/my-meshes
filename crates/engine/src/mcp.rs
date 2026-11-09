//! The MCP server's brain (ADR-0004): JSON-RPC messages in, results out. Transport, token
//! check and threading live in the shell; this module only knows the engine, so every tool
//! is testable without a socket. Protocol: MCP 2025-06-18, tools and prompts, no resources,
//! stateless (no session ids, no server-initiated messages).
//!
//! Tools come in two sets. Reading ones are always on. Writing ones (metadata, imports,
//! renames, moves, favorites, collections) only exist while "allow writes" is on; a client
//! that listed tools before the switch flipped gets a clear error, not a silent no-op.
//! Deleting ones (files, projects, duplicates, always to the trash) need the third switch on
//! top; every deleting or moving tool takes `dry_run`.

use crate::engine::{BatchUpdate, MoveFilesDest, PromoteItem, UpdateMetadata};
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
hint, a readme or a model page; leave a field alone rather than guess. Deleting tools, when the user allows them, only move to the trash; \
use dry_run first and tell the user what went. A packed project (`packed` in get_project) keeps its models inside a zip in its folder: its files \
are listed as `<archive>/<path>` and can be read, but not moved or deleted one by one; unpack_projects extracts them, pack_projects packs loose \
models, and execute_import with action `packed` adds a zip download without extracting it (smaller on disk, far fewer files to sync).";

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
        "initialize" => {
            // the libraries' own rules ride along, so an agent follows them without asking (#58)
            let conv = engine.conventions_summary();
            let instructions = if conv.is_empty() {
                INSTRUCTIONS.to_string()
            } else {
                format!("{INSTRUCTIONS}\n\n{conv}")
            };
            Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false }, "prompts": { "listChanged": false } },
                "serverInfo": server_info(),
                "instructions": instructions,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => {
            let s = engine.mcp_settings();
            Ok(json!({ "tools": tools(s.allow_writes, s.allow_writes && s.allow_deletes) }))
        }
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
pub fn tools(allow_writes: bool, allow_deletes: bool) -> Vec<Value> {
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
            "get_conventions",
            "The written conventions of a library root (.meshkeep/conventions.yaml): layout pattern, title cleanups, tag format, allowed licenses, duplicate policy and free-text notes. Follow them. Without root_id, every root.",
            schema(&[("root_id", s("Library root id"))], &[]),
            true,
            false,
        ),
        tool(
            "check_conventions",
            "Where projects of a root deviate from its conventions: wrong folder, a title the rules would clean, a license outside the list, tags not in the format. `fixable` says whether organize can fix it.",
            schema(&[("root_id", s("Library root id"))], &["root_id"]),
            true,
            false,
        ),
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
                "Create projects from archives, folders or files in the import folders (see analyze_import for the items). Each item: source path, action (project | packed | inbox | skip) and the project name. With `packed` (zip only) the archive itself goes into the new project folder unextracted and the app reads the models from it; with archive_policy trash or originals it is moved there, otherwise copied. With `project` a zip or 7z is extracted into the new project folder; a folder is copied; a loose model file (stl, 3mf, obj, ...) is copied into the new folder as it is, never extracted. A failed item leaves nothing behind. With apply_hints the creator, license and link found in the files are written into each new project.yaml; with fetch_pages the model page is read too (needs the network setting). archive_policy applies to zip and 7z only, never to model files: keep (copy the archive into the project), originals (move it to <root>/_Originals), trash, or leave (leave it where it is).",
                schema(
                    &[
                        ("root_id", s("Library root that receives the projects")),
                        ("items", json!({ "type": "array", "items": { "type": "object", "properties": { "source": { "type": "string" }, "action": { "type": "string", "enum": ["project", "packed", "inbox", "skip"] }, "name": { "type": "string" } }, "required": ["source", "action"] }, "description": "What to import" })),
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
            tool(
                "pack_projects",
                "Pack projects (LIB-9): the loose model files of each project go into <folder>.zip inside its folder (deflate, verified against the files on disk), project.yaml names the archive, and the loose models move to the trash. Images and readmes stay loose. The app keeps reading models, previews and duplicates from the archive. Saves space and, on synced folders, a lot of files. With dry_run only lists what would be packed.",
                schema(&[("project_ids", strings("Project ids")), ("dry_run", b("Only report"))], &["project_ids"]),
                false,
                false,
            ),
            tool(
                "unpack_projects",
                "Extract packed projects back into their folders (nothing is overwritten; a download's single wrapper folder is stripped). With keep_archive the zip stays as an attachment, otherwise it goes to the trash. With dry_run only lists the files that would appear.",
                schema(
                    &[("project_ids", strings("Project ids")), ("keep_archive", b("Keep the zip in the project (default false)")), ("dry_run", b("Only report"))],
                    &["project_ids"],
                ),
                false,
                false,
            ),
            tool(
                "organize",
                "Fix the fixable deviations from a root's conventions: clean titles and tags through project.yaml, move projects into the folder the layout names. Licenses are only reported. With dry_run returns the plan.",
                schema(&[("root_id", s("Library root id")), ("dry_run", b("Only return the plan"))], &["root_id"]),
                false,
                false,
            ),
            tool(
                "move_files",
                "Move files out of a project into a folder of a root: an existing project, or a new folder that becomes a project once a model is in it (e.g. to take a loose model out of a creator's collection). The destination must not lie inside another project. A source left without models and project.yaml is dropped. With dry_run nothing moves.",
                schema(
                    &[
                        ("project_id", s("Project the files are in")),
                        ("rel_paths", strings("Files relative to that project")),
                        ("dest_root", s("Target root id (default: the project's root)")),
                        ("dest_rel", s("Target folder relative to the root, e.g. Cinderwing3D/Baby Rose")),
                        ("dry_run", b("Only report what would move")),
                    ],
                    &["project_id", "rel_paths", "dest_rel"],
                ),
                false,
                false,
            ),
            tool(
                "remove_empty_folders",
                "Remove folders that hold nothing at all (after moves), deepest first; a folder with any file left stays, so do the root, the inbox and the app's folders. With dry_run only lists them.",
                schema(
                    &[("root_id", s("Library root id")), ("rel", s("Only below this folder (default: the whole root)")), ("dry_run", b("Only list the folders"))],
                    &["root_id"],
                ),
                false,
                false,
            ),
        ]);
    }
    if allow_deletes {
        t.extend([
            tool(
                "delete_file",
                "Move one file of a project to the trash (never project.yaml). A project left without models and project.yaml is dropped from the library. With dry_run nothing is deleted.",
                schema(&[("project_id", s("Project id")), ("rel_path", s("File relative to the project")), ("dry_run", b("Only report"))], &["project_id", "rel_path"]),
                false,
                true,
            ),
            tool(
                "delete_project",
                "Move a whole project folder to the trash (never a library root). With dry_run nothing is deleted.",
                schema(&[("project_id", s("Project id")), ("dry_run", b("Only report"))], &["project_id"]),
                false,
                true,
            ),
            tool(
                "resolve_duplicates",
                "Keep one project of a duplicate group and move the members it fully covers (every model of theirs exists in it, by content) to the trash; what the Duplicates view's \"keep\" does. Run find_duplicates first; `covers` there says what goes. With dry_run only reports.",
                schema(&[("keep_project_id", s("The project to keep")), ("dry_run", b("Only report"))], &["keep_project_id"]),
                false,
                true,
            ),
            tool(
                "remove_shared_files",
                "Thin a project out: move the model files it shares (by content) with other projects to the trash, keeping the other projects; for a creator's collection whose loose models also exist as single, described projects. With dry_run only reports.",
                schema(&[("project_id", s("The project to thin out")), ("dry_run", b("Only report"))], &["project_id"]),
                false,
                true,
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
    let settings = engine.mcp_settings();
    let is_delete = matches!(
        name,
        "delete_file" | "delete_project" | "resolve_duplicates" | "remove_shared_files"
    );
    let is_write = is_delete
        || matches!(
            name,
            "update_metadata"
                | "batch_update"
                | "execute_import"
                | "promote_inbox"
                | "rename_project"
                | "move_projects"
                | "set_favorite"
                | "add_to_collection"
                | "move_files"
                | "remove_empty_folders"
                | "organize"
                | "pack_projects"
                | "unpack_projects"
        );
    if is_write && !settings.allow_writes {
        return Err(ToolError::Failed(format!(
            "{name} is not available: writes are off. The user can allow them in Settings → MCP server."
        )));
    }
    if is_delete && !settings.allow_deletes {
        return Err(ToolError::Failed(format!(
            "{name} is not available: deleting is off. The user can allow it (to the trash) in Settings → MCP server."
        )));
    }
    let dry_run = arg_bool(args, "dry_run").unwrap_or(false);
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
                    "favorite": p.favorite, "offline": p.offline, "packed": p.packed.is_some(),
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
            let located = engine.locate(&id, &rel)?;
            let size = match &located {
                crate::packed::Located::Disk(path) => std::fs::metadata(path).map_err(|e| e.to_string())?.len(),
                crate::packed::Located::Packed { .. } => engine
                    .get_project(&id)?
                    .files
                    .iter()
                    .find(|f| f.rel_path == rel)
                    .map(|f| f.size)
                    .ok_or_else(|| ToolError::Failed(format!("{rel} is not in the packed archive")))?,
            };
            if size > MAX_TEXT_BYTES {
                return Err(format!("{rel} is {size} bytes; only text files up to {MAX_TEXT_BYTES} bytes are read").into());
            }
            let bytes = located.read()?;
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
                    "members": g.members.iter().map(|m| json!({ "id": m.project.id, "title": m.project.title, "rel_path": m.project.rel_path, "shared_files": m.shared_files, "model_files": m.model_files, "covers": m.covers, "shared": m.shared })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }))
        }
        "list_collections" => Ok(json!({ "collections": engine
            .collections()
            .iter()
            .map(|c| json!({ "id": c.id, "name": c.name, "projects": c.projects.len() }))
            .collect::<Vec<_>>() })),
        "get_conventions" => {
            let roots: Vec<_> = match arg_str(args, "root_id") {
                Some(id) => vec![engine.root(&id)?],
                None => engine.roots()?,
            };
            Ok(json!({ "roots": roots.iter().map(|r| {
                let (conventions, error) = match engine.conventions(&r.id) {
                    Ok(c) => (c, None),
                    Err(e) => (None, Some(e.to_string())),
                };
                json!({ "root_id": r.id, "path": r.path, "file": r.path.join(crate::conventions::CONVENTIONS_REL), "conventions": conventions, "error": error })
            }).collect::<Vec<_>>() }))
        }
        "check_conventions" => {
            let root = need_str(args, "root_id")?;
            Ok(serde_json::to_value(engine.check_conventions(&root)?).unwrap_or_default())
        }
        "pack_projects" | "unpack_projects" => {
            let ids = arg_strings(args, "project_ids").unwrap_or_default();
            if ids.is_empty() {
                return Err("pass at least one project id".to_string().into());
            }
            let packing = name == "pack_projects";
            if dry_run {
                let mut rows = Vec::new();
                for id in &ids {
                    let p = engine.get_project(id)?;
                    rows.push(if packing {
                        let models: Vec<&crate::model::FileEntry> = p.files.iter().filter(|f| f.kind == FileKind::Model).collect();
                        json!({
                            "id": id, "already_packed": p.packed.is_some(),
                            "would_pack": models.iter().map(|f| f.rel_path.as_str()).collect::<Vec<_>>(),
                            "bytes": models.iter().map(|f| f.size).sum::<u64>(),
                        })
                    } else {
                        let prefix = p.packed.as_deref().map(|a| format!("{a}/"));
                        json!({
                            "id": id, "packed": p.packed,
                            "entries": p.files.iter().filter(|f| prefix.as_deref().is_some_and(|x| f.rel_path.starts_with(x))).map(|f| f.rel_path.as_str()).collect::<Vec<_>>(),
                            "bytes": p.files.iter().filter(|f| prefix.as_deref().is_some_and(|x| f.rel_path.starts_with(x))).map(|f| f.size).sum::<u64>(),
                        })
                    });
                }
                return Ok(json!({ "dry_run": true, "projects": rows }));
            }
            let r = if packing {
                engine.pack_projects(&ids, |_| {})
            } else {
                engine.unpack_projects(&ids, arg_bool(args, "keep_archive").unwrap_or(false), |_| {})
            };
            if !r.projects.is_empty() {
                changes.push(Change::Library {
                    root_id: None,
                    reason: "pack".into(),
                });
            }
            Ok(json!({
                "projects": r.projects.iter().map(|p| json!({ "id": p.id, "rel_path": p.rel_path, "packed": p.packed, "model_count": p.model_count, "total_bytes": p.total_bytes })).collect::<Vec<_>>(),
                "failed": r.failed, "bytes_before": r.bytes_before, "bytes_after": r.bytes_after, "warnings": r.warnings,
            }))
        }
        "organize" => {
            let root = need_str(args, "root_id")?;
            let r = engine.organize(&root, dry_run)?;
            if !dry_run && !r.applied.is_empty() {
                changes.push(Change::Library {
                    root_id: Some(root),
                    reason: "move".into(),
                });
            }
            Ok(serde_json::to_value(r).unwrap_or_default())
        }
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
                    Some("packed") => ImportAction::Packed,
                    Some("inbox") => ImportAction::Inbox,
                    Some("skip") => ImportAction::Skip,
                    other => return Err(format!("unknown action {other:?}; use project, packed, inbox or skip").into()),
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
        "move_files" => {
            let id = need_str(args, "project_id")?;
            let rels = arg_strings(args, "rel_paths").unwrap_or_default();
            if rels.is_empty() {
                return Err("pass at least one file in rel_paths".to_string().into());
            }
            let p = engine.get_project(&id)?;
            let dest = MoveFilesDest {
                root_id: arg_str(args, "dest_root").unwrap_or_else(|| p.root_id.clone()),
                rel: need_str(args, "dest_rel")?,
            };
            if dry_run {
                let missing: Vec<&str> = rels
                    .iter()
                    .filter(|r| !p.files.iter().any(|f| &f.rel_path == *r))
                    .map(|s| s.as_str())
                    .collect();
                if !missing.is_empty() {
                    return Err(format!("not in the project: {}", missing.join(", ")).into());
                }
                return Ok(
                    json!({ "dry_run": true, "would_move": rels, "from": engine.project_dir(&p).ok(), "to": format!("{}/{}", dest.root_id, dest.rel.trim_matches('/')) }),
                );
            }
            let r = engine.move_files(&id, &rels, &dest)?;
            changes.push(Change::Library {
                root_id: Some(dest.root_id.clone()),
                reason: "move".into(),
            });
            if r.source.is_none() {
                changes.push(Change::Library {
                    root_id: Some(p.root_id.clone()),
                    reason: "delete".into(),
                });
            }
            Ok(json!({
                "moved": r.moved, "failed": r.failed,
                "source": r.source.as_ref().map(|p| json!({ "id": p.id, "rel_path": p.rel_path, "model_count": p.model_count })),
                "source_dropped": r.source.is_none(),
                "dest": r.dest.as_ref().map(|p| json!({ "id": p.id, "rel_path": p.rel_path, "model_count": p.model_count, "folder": engine.project_dir(p).ok() })),
            }))
        }
        "remove_empty_folders" => {
            let root = need_str(args, "root_id")?;
            let rel = arg_str(args, "rel");
            let removed = engine.prune_empty_dirs(&root, rel.as_deref(), dry_run)?;
            if !dry_run && !removed.is_empty() {
                changes.push(Change::Library {
                    root_id: Some(root),
                    reason: "scan".into(),
                });
            }
            Ok(json!({ "dry_run": dry_run, "folders": removed }))
        }
        "delete_file" => {
            let id = need_str(args, "project_id")?;
            let rel = need_str(args, "rel_path")?;
            let p = engine.get_project(&id)?;
            let path = engine.resolve_file(&id, &rel)?;
            if dry_run {
                let last_model = p.model_count <= 1 && p.files.iter().any(|f| f.rel_path == rel && f.kind == FileKind::Model);
                return Ok(
                    json!({ "dry_run": true, "would_trash": [path], "project_dropped": last_model && p.sidecar == crate::model::SidecarState::Missing }),
                );
            }
            let after = engine.delete_file(&id, &rel)?;
            changes.push(match &after {
                Some(_) => Change::Project(id.clone()),
                None => Change::Library {
                    root_id: Some(p.root_id.clone()),
                    reason: "delete".into(),
                },
            });
            Ok(
                json!({ "trashed": [path], "project_dropped": after.is_none(), "project": after.map(|p| json!({ "id": p.id, "model_count": p.model_count })) }),
            )
        }
        "delete_project" => {
            let id = need_str(args, "project_id")?;
            let p = engine.get_project(&id)?;
            let dir = engine.project_dir(&p)?;
            if p.rel_path.is_empty() {
                return Err("the library root itself cannot be deleted; remove it in settings"
                    .to_string()
                    .into());
            }
            if dry_run {
                return Ok(json!({ "dry_run": true, "would_trash": [dir], "files": p.files.len() }));
            }
            engine.delete_project(&id)?;
            changes.push(Change::Library {
                root_id: Some(p.root_id.clone()),
                reason: "delete".into(),
            });
            Ok(json!({ "trashed": [dir], "files": p.files.len() }))
        }
        "resolve_duplicates" => {
            let keep = need_str(args, "keep_project_id")?;
            let report = engine.find_duplicates(|_| {})?;
            let member = report
                .groups
                .iter()
                .flat_map(|g| g.members.iter())
                .find(|m| m.project.id == keep)
                .ok_or_else(|| ToolError::Failed(format!("{keep} is not part of any duplicate group")))?;
            let covered = member.covers.clone();
            if covered.is_empty() {
                return Err(format!("{keep} covers no other project; every other member has a model it lacks").into());
            }
            let mut rows = Vec::new();
            for id in &covered {
                let p = engine.get_project(id)?;
                rows.push(json!({ "id": id, "rel_path": p.rel_path, "folder": engine.project_dir(&p).ok(), "files": p.files.len() }));
            }
            if dry_run {
                return Ok(json!({ "dry_run": true, "keep": keep, "would_trash": rows }));
            }
            let mut trashed = Vec::new();
            let mut failed = Vec::new();
            for (id, row) in covered.iter().zip(rows) {
                match engine.delete_project(id) {
                    Ok(()) => trashed.push(row),
                    Err(e) => failed.push(json!({ "id": id, "message": e.to_string() })),
                }
            }
            changes.push(Change::Library {
                root_id: None,
                reason: "delete".into(),
            });
            Ok(json!({ "keep": keep, "trashed": trashed, "failed": failed }))
        }
        "remove_shared_files" => {
            let id = need_str(args, "project_id")?;
            let report = engine.find_duplicates(|_| {})?;
            let member = report
                .groups
                .iter()
                .flat_map(|g| g.members.iter())
                .find(|m| m.project.id == id)
                .ok_or_else(|| ToolError::Failed(format!("{id} is not part of any duplicate group")))?;
            let shared = member.shared.clone();
            let p = engine.get_project(&id)?;
            if p.packed.is_some() {
                return Err(format!(
                    "{id} is packed: single files cannot be removed from the archive; unpack it first or use resolve_duplicates"
                )
                .into());
            }
            let dir = engine.project_dir(&p)?;
            let rows: Vec<Value> = shared
                .iter()
                .map(|f| json!({ "rel_path": f.rel_path, "path": dir.join(&f.rel_path), "also_in": f.also_in }))
                .collect();
            let keeps_models = p.model_count as usize > shared.len();
            if dry_run {
                return Ok(
                    json!({ "dry_run": true, "would_trash": rows, "project_dropped": !keeps_models && p.sidecar == crate::model::SidecarState::Missing }),
                );
            }
            let mut trashed = Vec::new();
            let mut failed = Vec::new();
            let mut dropped = false;
            for (f, row) in shared.iter().zip(rows) {
                if dropped {
                    failed.push(json!({ "rel_path": f.rel_path, "message": "the project was dropped before this file" }));
                    continue;
                }
                match engine.delete_file(&id, &f.rel_path) {
                    Ok(after) => {
                        trashed.push(row);
                        dropped = after.is_none();
                    }
                    Err(e) => failed.push(json!({ "rel_path": f.rel_path, "message": e.to_string() })),
                }
            }
            changes.push(if dropped {
                Change::Library {
                    root_id: Some(p.root_id.clone()),
                    reason: "delete".into(),
                }
            } else {
                Change::Project(id.clone())
            });
            Ok(json!({ "trashed": trashed, "failed": failed, "project_dropped": dropped }))
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
        "packed": p.packed,
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
        assert_eq!(list(&mut engine), read_only + 13);
        let (r, _) = call(&mut engine, 3, "no_such_tool", json!({}));
        assert_eq!(r["error"]["code"], -32602);
        // deleting needs the third switch, which needs writes
        let (r, _) = call(&mut engine, 4, "delete_project", json!({ "project_id": "x" }));
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("deleting is off"));
        engine
            .set_mcp_settings(McpSettings {
                allow_writes: false,
                allow_deletes: true,
                ..Default::default()
            })
            .unwrap();
        assert!(!engine.mcp_settings().allow_deletes, "deletes never stay on without writes");
        engine
            .set_mcp_settings(McpSettings {
                allow_writes: true,
                allow_deletes: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(list(&mut engine), read_only + 17);
    }

    /// LIB-9 over MCP: a zip download is added packed, read in place, unpacked and packed again.
    #[test]
    fn packed_projects_over_mcp() {
        use crate::model::SyncMode;
        use std::io::Write;
        let data = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        touch(&lib.path().join("Existing/part.stl"), 10);
        let zip_path = downloads.path().join("Cable Clip.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        for (name, body) in [
            ("Cable Clip/clip.stl", &b"solid clip clip clip"[..]),
            ("Cable Clip/README.md", b"by PrintTools\nCC0\n"),
        ] {
            zip.start_file(name, o).unwrap();
            zip.write_all(body).unwrap();
        }
        zip.finish().unwrap();
        let mut engine = Engine::open(data.path()).unwrap();
        engine.set_deleter(Box::new(|p: &Path| {
            if p.is_dir() {
                std::fs::remove_dir_all(p)
            } else {
                std::fs::remove_file(p)
            }
        }));
        engine
            .set_mcp_settings(McpSettings {
                enabled: true,
                allow_writes: true,
                import_dirs: vec![downloads.path().to_path_buf()],
                ..Default::default()
            })
            .unwrap();
        let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();
        let id = format!("{}:Cable Clip", root.id);

        let (r, changes) = call(
            &mut engine,
            1,
            "execute_import",
            json!({ "root_id": root.id, "items": [{ "source": zip_path, "action": "packed", "name": "Cable Clip" }] }),
        );
        let v = structured(&r);
        assert_eq!(v["packed"], json!(["Cable Clip"]));
        assert_eq!(v["metadata_written"], 1);
        assert!(!changes.is_empty());
        assert!(zip_path.is_file(), "the default policy over MCP leaves the download where it is");
        assert!(lib.path().join("Cable Clip/Cable Clip.zip").is_file());
        assert!(!lib.path().join("Cable Clip/clip.stl").exists());

        let (r, _) = call(&mut engine, 2, "get_project", json!({ "project_id": id }));
        let v = structured(&r);
        assert_eq!(v["packed"], "Cable Clip.zip");
        assert_eq!(v["creator"], "PrintTools");
        assert!(v["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["rel_path"] == "Cable Clip.zip/Cable Clip/clip.stl"));
        let (r, _) = call(&mut engine, 3, "search_projects", json!({ "text": "clip" }));
        assert_eq!(structured(&r)["projects"][0]["packed"], true);
        let (r, _) = call(
            &mut engine,
            4,
            "read_project_file",
            json!({ "project_id": id, "rel_path": "Cable Clip.zip/Cable Clip/README.md" }),
        );
        assert!(structured(&r)["text"].as_str().unwrap().contains("PrintTools"));
        let (r, _) = call(
            &mut engine,
            5,
            "move_files",
            json!({ "project_id": id, "rel_paths": ["Cable Clip.zip/Cable Clip/clip.stl"], "dest_rel": "Elsewhere" }),
        );
        assert!(
            r["result"]["structuredContent"]["failed"][0]["message"]
                .as_str()
                .unwrap()
                .contains("unpack the project first"),
            "{r}"
        );

        let (r, changes) = call(&mut engine, 6, "unpack_projects", json!({ "project_ids": [id], "dry_run": true }));
        assert_eq!(structured(&r)["projects"][0]["entries"].as_array().unwrap().len(), 2);
        assert!(changes.is_empty());
        let (r, _) = call(&mut engine, 7, "unpack_projects", json!({ "project_ids": [id] }));
        let v = structured(&r);
        assert!(v["projects"][0]["packed"].is_null());
        assert!(lib.path().join("Cable Clip/clip.stl").is_file());
        assert!(!lib.path().join("Cable Clip/Cable Clip.zip").exists());

        let (r, _) = call(
            &mut engine,
            8,
            "pack_projects",
            json!({ "project_ids": [id, format!("{}:Existing", root.id)], "dry_run": true }),
        );
        assert_eq!(structured(&r)["projects"][0]["would_pack"], json!(["clip.stl"]));
        let (r, changes) = call(&mut engine, 9, "pack_projects", json!({ "project_ids": [id] }));
        let v = structured(&r);
        assert_eq!(v["projects"][0]["packed"], "Cable Clip.zip");
        assert_eq!(v["failed"], json!([]));
        assert!(matches!(&changes[0], Change::Library { reason, .. } if reason == "pack"));
        assert!(!lib.path().join("Cable Clip/clip.stl").exists());
        assert!(lib.path().join("Cable Clip/README.md").is_file(), "only models are packed");
    }

    /// The case from #58: a library sorted by creator with a shared folder, ids in titles,
    /// mixed tag formats and a license outside the list.
    #[test]
    fn conventions_reach_the_agent_and_organize_fixes_what_it_can() {
        use crate::model::SyncMode;
        let data = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let w = |p: &str, bytes: &[u8]| {
            let path = lib.path().join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        };
        w("unsorted/Baby Rose/rose.stl", b"solid");
        w(
            "unsorted/Baby Rose/project.yaml",
            b"metadata:\n  creator: Cinderwing3D\n  tags: [Print In Place, dragon]\n  license: CC-BY-ND-4.0\n",
        );
        w("unsorted/Cinder Snake/snake.stl", b"solid");
        w("unsorted/Cinder Snake/project.yaml", b"metadata:\n  creator: Cinderwing3D\n");
        w("Cinderwing3D/Jellyfish/jelly.stl", b"solid");
        w("Cinderwing3D/Jellyfish/project.yaml", b"metadata:\n  creator: Cinderwing3D\n");
        w("Small screws organizer - 6277078/box.stl", b"solid");
        w(
            "Small screws organizer - 6277078/project.yaml",
            b"metadata:\n  creator: One Hit Wonder\n",
        );
        w("Mystery/thing.stl", b"solid");
        let mut engine = Engine::open(data.path()).unwrap();
        engine
            .set_mcp_settings(McpSettings {
                enabled: true,
                allow_writes: true,
                ..Default::default()
            })
            .unwrap();
        let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();
        let id = |rel: &str| format!("{}:{rel}", root.id);

        // no file: nothing in the instructions, nothing to check
        let init = |e: &mut Engine| {
            handle(e, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }))
                .response
                .unwrap()["result"]["instructions"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert!(!init(&mut engine).contains("Conventions for"));
        let (r, _) = call(&mut engine, 2, "check_conventions", json!({ "root_id": root.id }));
        assert_eq!(structured(&r)["deviations"], json!([]));
        let (r, _) = call(&mut engine, 3, "get_conventions", json!({}));
        assert!(structured(&r)["roots"][0]["conventions"].is_null());

        // a broken file is reported, not ignored silently
        std::fs::create_dir_all(lib.path().join(".meshkeep")).unwrap();
        std::fs::write(
            lib.path().join(".meshkeep/conventions.yaml"),
            b"layout:\n  pattern: \"{creator}\"\n",
        )
        .unwrap();
        assert!(init(&mut engine).contains("invalid and ignored"));
        let (r, _) = call(&mut engine, 4, "get_conventions", json!({ "root_id": root.id }));
        assert!(structured(&r)["roots"][0]["error"].as_str().unwrap().contains("{title}"));
        let (r, _) = call(&mut engine, 5, "check_conventions", json!({ "root_id": root.id }));
        assert_eq!(r["result"]["isError"], true);

        // the real rules: survive a rescan, reach the agent, name every deviation
        let text = "layout:\n  pattern: \"{creator}/{title}\"\n  shared_folder: Misc\n  shared_threshold: 2\n  unknown_creator: Misc\ntitles:\n  strip: [thingiverse_id]\nmetadata:\n  tags: { case: lower, separator: \"-\" }\n  license_default: Personal use\n  licenses: [CC0-1.0, CC-BY-4.0, Personal use]\nnotes: |\n  Keep collections together.\n";
        engine.set_conventions_text(&root.id, text).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();
        let ins = init(&mut engine);
        assert!(ins.contains("Conventions for the library at"), "{ins}");
        assert!(ins.contains("Keep collections together"));
        let (r, _) = call(&mut engine, 6, "check_conventions", json!({ "root_id": root.id }));
        let v = structured(&r);
        assert_eq!(v["checked"], 5);
        let kinds: Vec<(String, String, String)> = v["deviations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| {
                (
                    d["kind"].as_str().unwrap().to_string(),
                    d["rel_path"].as_str().unwrap().to_string(),
                    d["expected"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert!(
            kinds.contains(&("folder".into(), "unsorted/Baby Rose".into(), "Cinderwing3D/Baby Rose".into())),
            "{kinds:?}"
        );
        assert!(kinds.contains(&("folder".into(), "unsorted/Cinder Snake".into(), "Cinderwing3D/Cinder Snake".into())));
        assert!(
            kinds.contains(&(
                "folder".into(),
                "Small screws organizer - 6277078".into(),
                "Misc/Small screws organizer - 6277078".into()
            )),
            "one project: shared folder"
        );
        assert!(
            kinds.contains(&("folder".into(), "Mystery".into(), "Misc/Mystery".into())),
            "no creator: unknown folder"
        );
        assert!(kinds.contains(&(
            "title".into(),
            "Small screws organizer - 6277078".into(),
            "Small screws organizer".into()
        )));
        assert!(kinds.contains(&("tags".into(), "unsorted/Baby Rose".into(), "dragon, print-in-place".into())));
        assert!(kinds.contains(&("license".into(), "unsorted/Baby Rose".into(), "Personal use".into())));
        assert!(!kinds.iter().any(|k| k.1 == "Cinderwing3D/Jellyfish"), "already where it belongs");

        // tag rules apply on every write, not only in organize
        let (r, _) = call(
            &mut engine,
            7,
            "update_metadata",
            json!({ "project_id": id("Cinderwing3D/Jellyfish"), "add_tags": ["Sea Life"] }),
        );
        assert_eq!(structured(&r)["tags"], json!(["sea-life"]));

        // the plan, then the fix: licenses stay for a person
        let (r, changes) = call(&mut engine, 8, "organize", json!({ "root_id": root.id, "dry_run": true }));
        let v = structured(&r);
        assert_eq!(v["planned"].as_array().unwrap().len(), 6);
        assert_eq!(v["skipped"][0]["kind"], "license");
        assert!(changes.is_empty());
        assert!(lib.path().join("unsorted/Baby Rose").is_dir());
        let (r, changes) = call(&mut engine, 9, "organize", json!({ "root_id": root.id }));
        let v = structured(&r);
        assert_eq!(v["applied"].as_array().unwrap().len(), 6, "{v}");
        assert_eq!(v["failed"], json!([]));
        assert!(!changes.is_empty());
        assert!(lib.path().join("Cinderwing3D/Baby Rose/rose.stl").is_file());
        assert!(lib.path().join("Misc/Mystery/thing.stl").is_file());
        assert!(
            lib.path().join("Misc/Small screws organizer - 6277078/box.stl").is_file(),
            "folders keep their names; only the title is cleaned"
        );
        let organizer = engine.get_project(&id("Misc/Small screws organizer - 6277078")).unwrap();
        assert_eq!(organizer.title, "Small screws organizer");
        let rose = engine.get_project(&id("Cinderwing3D/Baby Rose")).unwrap();
        assert_eq!(rose.tags, vec!["dragon", "print-in-place"]);
        assert_eq!(rose.license.as_deref(), Some("CC-BY-ND-4.0"), "not touched");
        let (r, _) = call(&mut engine, 10, "check_conventions", json!({ "root_id": root.id }));
        let left = structured(&r)["deviations"].as_array().unwrap().len();
        assert_eq!(left, 1, "only the license remains");
        // an empty text removes the file again
        engine.set_conventions_text(&root.id, "  ").unwrap();
        assert!(engine.conventions(&root.id).unwrap().is_none());
    }

    /// The case from #57: a creator's collection holds loose models that also exist as
    /// single, described projects; an old folder stays behind empty after a move.
    #[test]
    fn duplicates_files_and_empty_folders_can_be_cleaned_up_over_mcp() {
        use crate::model::SyncMode;
        let data = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let w = |p: &str, bytes: &[u8]| {
            let path = lib.path().join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        };
        w("Cinderwing3D/_cinderwing/rose.stl", b"ROSE-ROSE-ROSE");
        w("Cinderwing3D/_cinderwing/snake.stl", b"SNAKE-SNAKE-SNAKE-SNAKE");
        w("Cinderwing3D/_cinderwing/unique.stl", b"ONLY-HERE-ONLY-HERE");
        w("Cinderwing3D/_cinderwing/README.txt", b"all my dragons");
        w("Cinderwing3D/Baby Rose/rose.stl", b"ROSE-ROSE-ROSE");
        w(
            "Cinderwing3D/Baby Rose/project.yaml",
            b"metadata:\n  creator: Cinderwing3D\n  source_url: https://www.printables.com/model/1-baby-rose\n",
        );
        w("Cinderwing3D/Cinder Snake/snake.stl", b"SNAKE-SNAKE-SNAKE-SNAKE");
        w("Cinderwing3D/Cinder Snake/project.yaml", b"metadata:\n  creator: Cinderwing3D\n");
        w("unsorted/unsorted 2/Vase/vase.stl", b"VASE-VASE-VASE");
        w("unsorted/keep me/notes.txt", b"not a project, but not empty either");
        let mut engine = Engine::open(data.path()).unwrap();
        engine.set_deleter(Box::new(|p: &Path| {
            if p.is_dir() {
                std::fs::remove_dir_all(p)
            } else {
                std::fs::remove_file(p)
            }
        }));
        engine
            .set_mcp_settings(McpSettings {
                enabled: true,
                allow_writes: true,
                allow_deletes: true,
                ..Default::default()
            })
            .unwrap();
        let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
        engine.scan_root(&root.id, |_| {}).unwrap();
        let id = |rel: &str| format!("{}:{rel}", root.id);
        let coll = id("Cinderwing3D/_cinderwing");

        // the report names the shared files per member
        let (r, _) = call(&mut engine, 1, "find_duplicates", json!({}));
        let v = structured(&r);
        assert_eq!(v["groups"].as_array().unwrap().len(), 1);
        let members = v["groups"][0]["members"].as_array().unwrap();
        let c = members.iter().find(|m| m["id"] == coll).unwrap();
        assert_eq!(c["covers"].as_array().unwrap().len(), 2);
        assert_eq!(c["shared"].as_array().unwrap().len(), 2);
        assert_eq!(c["shared"][0]["rel_path"], "rose.stl");
        assert_eq!(c["shared"][0]["also_in"], json!([id("Cinderwing3D/Baby Rose")]));

        // dry runs change nothing
        let (r, changes) = call(
            &mut engine,
            2,
            "resolve_duplicates",
            json!({ "keep_project_id": coll, "dry_run": true }),
        );
        assert_eq!(structured(&r)["would_trash"].as_array().unwrap().len(), 2);
        assert!(changes.is_empty());
        assert!(lib.path().join("Cinderwing3D/Baby Rose/rose.stl").is_file());
        let (r, _) = call(
            &mut engine,
            3,
            "resolve_duplicates",
            json!({ "keep_project_id": id("Cinderwing3D/Baby Rose") }),
        );
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("covers no other project"));

        // thin the collection instead: the two shared files go, the unique one and the singles stay
        let (r, _) = call(
            &mut engine,
            4,
            "remove_shared_files",
            json!({ "project_id": coll, "dry_run": true }),
        );
        let v = structured(&r);
        assert_eq!(v["would_trash"].as_array().unwrap().len(), 2);
        assert_eq!(v["project_dropped"], false);
        let (r, changes) = call(&mut engine, 5, "remove_shared_files", json!({ "project_id": coll }));
        let v = structured(&r);
        assert_eq!(v["trashed"].as_array().unwrap().len(), 2);
        assert_eq!(v["project_dropped"], false);
        assert_eq!(changes, vec![Change::Project(coll.clone())]);
        assert!(!lib.path().join("Cinderwing3D/_cinderwing/rose.stl").exists());
        assert!(lib.path().join("Cinderwing3D/_cinderwing/unique.stl").is_file());
        assert!(lib.path().join("Cinderwing3D/Baby Rose/rose.stl").is_file());
        assert_eq!(engine.get_project(&coll).unwrap().model_count, 1);
        let (r, _) = call(&mut engine, 6, "find_duplicates", json!({}));
        assert_eq!(structured(&r)["groups"].as_array().unwrap().len(), 0);

        // take the last loose model out into its own project; the collection is left without
        // models and without a sidecar, so it is dropped
        let (r, _) = call(
            &mut engine,
            7,
            "move_files",
            json!({ "project_id": coll, "rel_paths": ["unique.stl", "nope.stl"], "dest_rel": "Cinderwing3D/Unique", "dry_run": true }),
        );
        assert_eq!(r["result"]["isError"], true, "dry run checks the files exist");
        let (r, _) = call(
            &mut engine,
            8,
            "move_files",
            json!({ "project_id": coll, "rel_paths": ["unique.stl"], "dest_rel": "Cinderwing3D/Baby Rose/inner" }),
        );
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("inside another project"));
        let (r, changes) = call(
            &mut engine,
            9,
            "move_files",
            json!({ "project_id": coll, "rel_paths": ["unique.stl", "README.txt"], "dest_rel": "Cinderwing3D/Unique" }),
        );
        let v = structured(&r);
        assert_eq!(v["moved"], json!(["unique.stl", "README.txt"]));
        assert_eq!(v["source_dropped"], true);
        assert_eq!(v["dest"]["rel_path"], "Cinderwing3D/Unique");
        assert!(changes
            .iter()
            .any(|c| matches!(c, Change::Library { reason, .. } if reason == "delete")));
        assert!(engine.get_project(&coll).is_err());
        assert!(lib.path().join("Cinderwing3D/Unique/unique.stl").is_file());
        assert_eq!(engine.get_project(&id("Cinderwing3D/Unique")).unwrap().model_count, 1);

        // a single file to the trash, then the project; project.yaml and the root are refused
        let (r, _) = call(
            &mut engine,
            10,
            "delete_file",
            json!({ "project_id": id("Cinderwing3D/Baby Rose"), "rel_path": "project.yaml" }),
        );
        assert_eq!(r["result"]["isError"], true);
        let (r, _) = call(
            &mut engine,
            11,
            "delete_file",
            json!({ "project_id": id("Cinderwing3D/Unique"), "rel_path": "README.txt" }),
        );
        assert_eq!(structured(&r)["project_dropped"], false);
        let (r, _) = call(
            &mut engine,
            12,
            "delete_project",
            json!({ "project_id": id("Cinderwing3D/Unique"), "dry_run": true }),
        );
        assert_eq!(structured(&r)["files"], 1);
        assert!(lib.path().join("Cinderwing3D/Unique").is_dir());
        let (r, _) = call(
            &mut engine,
            13,
            "delete_project",
            json!({ "project_id": id("Cinderwing3D/Unique") }),
        );
        assert!(structured(&r)["trashed"][0].as_str().unwrap().ends_with("Unique"));
        assert!(!lib.path().join("Cinderwing3D/Unique").exists());

        // moving the vase out leaves `unsorted/unsorted 2` empty; `keep me` has a file and stays
        let (r, _) = call(
            &mut engine,
            14,
            "move_projects",
            json!({ "project_ids": [id("unsorted/unsorted 2/Vase")], "dest_root": root.id, "dest_rel": "Vases" }),
        );
        assert_eq!(structured(&r)["moved"][0]["rel_path"], "Vases/Vase");
        let (r, _) = call(
            &mut engine,
            15,
            "remove_empty_folders",
            json!({ "root_id": root.id, "dry_run": true }),
        );
        // the emptied collection folder is listed too; `keep me` holds a file and is not
        assert_eq!(
            structured(&r)["folders"],
            json!(["Cinderwing3D/_cinderwing", "unsorted/unsorted 2"])
        );
        assert!(lib.path().join("unsorted/unsorted 2").is_dir());
        let (r, changes) = call(&mut engine, 16, "remove_empty_folders", json!({ "root_id": root.id }));
        assert_eq!(
            structured(&r)["folders"],
            json!(["Cinderwing3D/_cinderwing", "unsorted/unsorted 2"])
        );
        assert!(!changes.is_empty());
        assert!(!lib.path().join("Cinderwing3D/_cinderwing").exists());
        assert!(lib.path().join("Cinderwing3D").is_dir(), "still holds projects");
        assert!(!lib.path().join("unsorted/unsorted 2").exists());
        assert!(lib.path().join("unsorted/keep me/notes.txt").is_file());
        let (r, _) = call(&mut engine, 17, "remove_empty_folders", json!({ "root_id": root.id, "rel": "../" }));
        assert_eq!(r["result"]["isError"], true);
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
