//! AI assistance (ADR-0003, Epic 9): metadata suggestions from a hosted model behind a
//! user-supplied API key.
//!
//! Rules this module enforces:
//! - Nothing is sent without a key; the key never reaches `settings.json` (the shell keeps
//!   it in the OS credential store and hands it in per call).
//! - Only the thumbnail PNG, file names and sizes, README/license text and the current
//!   sidecar leave the machine. Model geometry never does.
//! - The model answers JSON against a fixed schema; the engine validates it before the UI
//!   sees it (tags trimmed and lower-cased, licenses from a known list, lengths capped).
//! - Responses are a cache keyed by a hash of the inputs (`<data dir>/ai-cache/`), never
//!   library content. The result is a suggestion; writing it is the sidecar save's job.

use crate::error::{io_err, EngineError, Result};
use crate::model::{FileKind, Project, TagCount};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
/// Haiku-class: the schema is small and the inputs are a picture and a few names (ADR-0003
/// "use the smallest model that fills the schema").
pub const DEFAULT_MODEL: &str = "claude-haiku-5-5";
const ANTHROPIC_VERSION: &str = "2026-10-21";
/// Room for the model's own reasoning plus the JSON; the schema itself is small.
const MAX_TOKENS: u32 = 2048;
const SCHEMA_VERSION: u32 = 1;
/// Largest thumbnail that goes into a request; ours are 512 px PNGs, far below this.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOC_CHARS: usize = 6000;
const MAX_DOCS: usize = 2;
const MAX_FILES: usize = 80;
const MAX_VOCAB: usize = 150;
const MAX_TAGS: usize = 12;

/// SPDX identifiers (plus the app's own "Personal use") a suggestion may carry; anything
/// else the model proposes is dropped rather than written into the sidecar.
pub const KNOWN_LICENSES: &[&str] = &[
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "CC-BY-NC-4.0",
    "CC-BY-NC-SA-4.0",
    "CC-BY-ND-4.0",
    "CC-BY-NC-ND-4.0",
    "CC0-1.0",
    "MIT",
    "Apache-2.0",
    "BSD-3-Clause",
    "GPL-3.0",
    "LGPL-3.0",
    "Personal use",
];

// ---- settings ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    #[default]
    Anthropic,
}

/// The `ai` block of `settings.json`. Never holds the key (Q26: the base URL is here from
/// the start so a local server is a configuration, not a new client).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AiSettings {
    #[serde(default)]
    pub provider: AiProviderKind,
    /// `None` means the provider's default endpoint.
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            provider: AiProviderKind::Anthropic,
            base_url: None,
            model: default_model(),
        }
    }
}

impl AiSettings {
    /// Trims, drops empty values and refuses anything that is not an http(s) origin.
    pub fn normalized(mut self) -> Result<AiSettings> {
        self.base_url = self
            .base_url
            .map(|u| u.trim().trim_end_matches('/').to_string())
            .filter(|u| !u.is_empty());
        if let Some(u) = &self.base_url {
            if !(u.starts_with("https://") || u.starts_with("http://")) {
                return Err(EngineError::NotAllowed(format!(
                    "base URL must start with http:// or https://: {u}"
                )));
            }
        }
        self.model = self.model.trim().to_string();
        if self.model.is_empty() {
            self.model = default_model();
        }
        Ok(self)
    }

    pub fn effective_base_url(&self) -> &str {
        self.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL)
    }
}

// ---- provider ---------------------------------------------------------------------------

/// One model call: a system prompt, the user text, an optional PNG and the JSON schema the
/// answer must follow. `subject` is a short label (the project folder) for logs and mocks.
#[derive(Debug, Clone)]
pub struct AiRequest {
    pub subject: String,
    pub system: String,
    pub text: String,
    pub image_png: Option<Vec<u8>>,
    pub schema: serde_json::Value,
    pub max_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct AiResponse {
    pub json: serde_json::Value,
    pub model: String,
}

pub trait AiProvider: Send + Sync {
    fn complete(&self, req: &AiRequest) -> Result<AiResponse>;
}

/// Shared handle: the engine keeps one, a long call runs outside the engine lock.
pub type SharedProvider = Arc<dyn AiProvider>;

/// The Anthropic Messages API over plain HTTPS (raw HTTP; there is no official Rust SDK).
pub struct AnthropicProvider {
    base_url: String,
    model: String,
    api_key: String,
    client: reqwest::blocking::Client,
}

impl AnthropicProvider {
    pub fn new(settings: &AiSettings, api_key: &str) -> Result<AnthropicProvider> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| EngineError::AiUnavailable(e.to_string()))?;
        Ok(AnthropicProvider {
            base_url: settings.effective_base_url().to_string(),
            model: settings.model.clone(),
            api_key: api_key.to_string(),
            client,
        })
    }
}

#[derive(Deserialize)]
struct MessagesResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

impl AiProvider for AnthropicProvider {
    fn complete(&self, req: &AiRequest) -> Result<AiResponse> {
        use base64::Engine as _;
        let mut content = Vec::new();
        if let Some(png) = &req.image_png {
            content.push(serde_json::json!({
                "type": "image",
                "source": { "type": "base64", "media_type": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(png) }
            }));
        }
        content.push(serde_json::json!({ "type": "text", "text": req.text }));
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": [{ "role": "user", "content": content }],
            "output_config": { "effort": "low", "format": { "type": "json_schema", "schema": req.schema } }
        });
        let url = format!("{}/v1/messages", self.base_url);
        tracing::debug!(subject = %req.subject, model = %self.model, "ai request");
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| EngineError::AiUnavailable(sanitize(&e.to_string(), &self.api_key)))?;
        let status = resp.status();
        let text = resp
            .text()
            .map_err(|e| EngineError::AiUnavailable(sanitize(&e.to_string(), &self.api_key)))?;
        if !status.is_success() {
            let detail = error_detail(&text);
            return Err(match status.as_u16() {
                401 | 403 => EngineError::AiUnauthorized(detail),
                429 => EngineError::AiRateLimited(detail),
                400 | 404 | 422 => EngineError::AiInvalidResponse(format!("HTTP {status}: {detail}")),
                _ => EngineError::AiUnavailable(format!("HTTP {status}: {detail}")),
            });
        }
        let parsed: MessagesResponse =
            serde_json::from_str(&text).map_err(|e| EngineError::AiInvalidResponse(format!("response is not JSON: {e}")))?;
        match parsed.stop_reason.as_deref() {
            Some("refusal") => return Err(EngineError::AiInvalidResponse("the model declined this request".into())),
            Some("max_tokens") => return Err(EngineError::AiInvalidResponse("answer was cut off (max_tokens)".into())),
            _ => {}
        }
        let answer = parsed
            .content
            .iter()
            .find(|b| b.kind == "text")
            .and_then(|b| b.text.clone())
            .ok_or_else(|| EngineError::AiInvalidResponse("no text block in the answer".into()))?;
        let json: serde_json::Value =
            serde_json::from_str(answer.trim()).map_err(|e| EngineError::AiInvalidResponse(format!("answer is not JSON: {e}")))?;
        Ok(AiResponse {
            json,
            model: parsed.model.unwrap_or_else(|| self.model.clone()),
        })
    }
}

/// Error bodies look like `{"error":{"type":"...","message":"..."}}`; keep the message.
fn error_detail(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

/// Keeps a key out of error messages (reqwest echoes URLs, not headers, but be safe).
fn sanitize(msg: &str, key: &str) -> String {
    if key.len() >= 8 {
        msg.replace(key, "***")
    } else {
        msg.to_string()
    }
}

// ---- mock provider (tests, `MESHKEEP_AI_MOCK`) -------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockMode {
    /// A deterministic suggestion derived from the subject.
    Ok,
    Unauthorized,
    RateLimited,
    /// Returns something that is not the schema.
    Invalid,
    Unavailable,
}

impl MockMode {
    /// `MESHKEEP_AI_MOCK` values: `ok` (or `1`), `unauthorized`, `rate_limited`, `invalid`,
    /// `unavailable`.
    pub fn parse(s: &str) -> Option<MockMode> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "1" | "ok" | "true" => MockMode::Ok,
            "unauthorized" => MockMode::Unauthorized,
            "rate_limited" | "ratelimited" => MockMode::RateLimited,
            "invalid" => MockMode::Invalid,
            "unavailable" => MockMode::Unavailable,
            _ => return None,
        })
    }
}

/// Canned answers so UI and E2E tests run without network. Counts its calls so a test can
/// prove a cache hit.
pub struct MockProvider {
    pub mode: MockMode,
    pub calls: AtomicUsize,
}

impl MockProvider {
    pub fn new(mode: MockMode) -> MockProvider {
        MockProvider {
            mode,
            calls: AtomicUsize::new(0),
        }
    }
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl AiProvider for MockProvider {
    fn complete(&self, req: &AiRequest) -> Result<AiResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match self.mode {
            MockMode::Unauthorized => Err(EngineError::AiUnauthorized("mock: invalid key".into())),
            MockMode::RateLimited => Err(EngineError::AiRateLimited("mock: slow down".into())),
            MockMode::Unavailable => Err(EngineError::AiUnavailable("mock: no network".into())),
            MockMode::Invalid => Ok(AiResponse {
                json: serde_json::json!("not an object"),
                model: "mock".into(),
            }),
            MockMode::Ok if req.subject == "connection test" => Ok(AiResponse {
                json: serde_json::json!({ "ok": true }),
                model: "mock".into(),
            }),
            MockMode::Ok => {
                let words: Vec<String> = req
                    .subject
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|w| w.len() > 2)
                    .map(|w| w.to_lowercase())
                    .collect();
                let mut tags = words.clone();
                tags.push("mock".into());
                let title: Vec<String> = req
                    .subject
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|w| !w.is_empty())
                    .map(|w| {
                        let mut cs = w.chars();
                        match cs.next() {
                            Some(f) => f.to_uppercase().collect::<String>() + cs.as_str(),
                            None => String::new(),
                        }
                    })
                    .collect();
                Ok(AiResponse {
                    json: serde_json::json!({
                        "title": title.join(" "),
                        "creator": "Mock Creator",
                        "license": "CC-BY-4.0",
                        "description": format!("Mock description for {}.", req.subject),
                        "tags": tags,
                    }),
                    model: "mock".into(),
                })
            }
        }
    }
}

// ---- suggestion -------------------------------------------------------------------------

/// What left the machine for this suggestion, shown in the dialog (ADR-0003 principle 3).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiSent {
    pub thumbnail: bool,
    pub files: u32,
    pub documents: Vec<String>,
    pub sidecar: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MetadataSuggestion {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    /// Tags in `tags` that no project in the library carries yet (Q24: shown as new).
    pub new_tags: Vec<String>,
    pub model: String,
    pub cached: bool,
    pub sent: AiSent,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiTestReport {
    pub model: String,
}

#[derive(Deserialize)]
struct RawSuggestion {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    creator: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

fn suggestion_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "title": { "type": ["string", "null"], "description": "Short, human-readable project title. Null when the current title is already good." },
            "creator": { "type": ["string", "null"], "description": "Designer or author name if it can be read from the inputs, else null. Never guess." },
            "license": { "type": ["string", "null"], "enum": KNOWN_LICENSES.iter().map(|l| serde_json::Value::from(*l)).chain(std::iter::once(serde_json::Value::Null)).collect::<Vec<_>>(), "description": "SPDX identifier when the inputs state the license, else null." },
            "description": { "type": ["string", "null"], "description": "One to three sentences on what the model is and what it is for." },
            "tags": { "type": "array", "items": { "type": "string" }, "description": "Up to 8 lower-case tags. Prefer tags from the library vocabulary; add a new one only when nothing fits." }
        },
        "required": ["title", "creator", "license", "description", "tags"],
        "additionalProperties": false
    })
}

const SYSTEM_PROMPT: &str = "You help a hobbyist catalogue a local 3D-printing model library. \
You see a rendered preview of one project (when available), its folder and file names, text files from the download, \
and the metadata already recorded. Propose metadata for the project.yaml sidecar. Be concrete and brief. \
Only fill creator and license when the inputs state them; never invent names or licenses. \
Tags are lower-case single words or hyphenated phrases; reuse the library vocabulary wherever it fits. \
Answer with JSON only.";

/// Everything needed for one call, built under the engine lock; the call itself runs without
/// it (`run_suggestion`).
pub struct PreparedSuggestion {
    pub request: AiRequest,
    pub cache_path: PathBuf,
    pub vocabulary: Vec<String>,
    pub sent: AiSent,
    /// A cached answer; when `Some`, no call is needed.
    pub cached: Option<MetadataSuggestion>,
}

fn folder_name(p: &Project, root_dir: &Path) -> String {
    match p.rel_path.rsplit('/').next() {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => root_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.title.clone()),
    }
}

fn is_text_doc(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let ext_ok = lower.ends_with(".md") || lower.ends_with(".txt");
    let stem_ok = ["readme", "license", "licence", "notes", "about", "info", "description"]
        .iter()
        .any(|k| lower.contains(k));
    ext_ok && (stem_ok || lower.len() <= 24)
}

fn clip(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max_chars).collect();
        format!("{cut}\n[truncated]")
    }
}

/// Builds the prompt from what the project already has on disk. Reads README-like text
/// files and the cached thumbnail; never a model file.
pub fn prepare(
    data_dir: &Path,
    project: &Project,
    project_dir: &Path,
    thumbnail: Option<&Path>,
    tag_counts: &[TagCount],
    model: &str,
) -> Result<PreparedSuggestion> {
    let subject = folder_name(project, project_dir);
    let mut text = String::new();
    text.push_str(&format!("Project folder: {subject}\n"));
    if !project.rel_path.is_empty() {
        text.push_str(&format!("Path in library: {}\n", project.rel_path));
    }
    let mut sent = AiSent::default();

    // current sidecar values
    let has_sidecar = matches!(project.sidecar, crate::model::SidecarState::Ok);
    if has_sidecar || !project.tags.is_empty() || project.creator.is_some() || project.description.is_some() {
        sent.sidecar = true;
        text.push_str("\nCurrent metadata:\n");
        text.push_str(&format!("- title: {}\n", project.title));
        if let Some(c) = &project.creator {
            text.push_str(&format!("- creator: {c}\n"));
        }
        if let Some(l) = &project.license {
            text.push_str(&format!("- license: {l}\n"));
        }
        if let Some(u) = &project.source_url {
            text.push_str(&format!("- source_url: {u}\n"));
        }
        if let Some(d) = &project.description {
            text.push_str(&format!("- description: {}\n", clip(d, 600)));
        }
        if !project.tags.is_empty() {
            text.push_str(&format!("- tags: {}\n", project.tags.join(", ")));
        }
    } else {
        text.push_str(&format!("Current title (from the folder name): {}\n", project.title));
    }

    // file list
    text.push_str("\nFiles:\n");
    for f in project.files.iter().take(MAX_FILES) {
        let kind = match f.kind {
            FileKind::Model => "model",
            FileKind::Image => "image",
            FileKind::Document => "document",
            FileKind::Attachment => "archive",
            FileKind::Other => "other",
        };
        text.push_str(&format!("- {} ({kind}, {} KB)\n", f.rel_path, f.size / 1024));
    }
    if project.files.len() > MAX_FILES {
        text.push_str(&format!("- ... and {} more\n", project.files.len() - MAX_FILES));
    }
    sent.files = project.files.len().min(MAX_FILES) as u32;

    // README-like documents
    let mut docs = 0;
    for f in project
        .files
        .iter()
        .filter(|f| f.kind == FileKind::Document && is_text_doc(&f.name))
    {
        if docs >= MAX_DOCS {
            break;
        }
        let path = project_dir.join(&f.rel_path);
        match std::fs::read_to_string(&path) {
            Ok(body) => {
                text.push_str(&format!("\n--- {} ---\n{}\n", f.rel_path, clip(body.trim(), MAX_DOC_CHARS)));
                sent.documents.push(f.rel_path.clone());
                docs += 1;
            }
            Err(e) => tracing::debug!("ai: skip {}: {e}", path.display()),
        }
    }

    // vocabulary
    let vocabulary: Vec<String> = tag_counts.iter().take(MAX_VOCAB).map(|t| t.tag.clone()).collect();
    if !vocabulary.is_empty() {
        text.push_str(&format!("\nLibrary tag vocabulary: {}\n", vocabulary.join(", ")));
    }

    // thumbnail
    let image_png = thumbnail.and_then(|p| match std::fs::read(p) {
        Ok(bytes) if bytes.len() <= MAX_IMAGE_BYTES && bytes.starts_with(b"\x89PNG") => Some(bytes),
        Ok(_) => None,
        Err(e) => {
            tracing::debug!("ai: no thumbnail {}: {e}", p.display());
            None
        }
    });
    sent.thumbnail = image_png.is_some();
    if sent.thumbnail {
        text.push_str("\nThe attached image is a rendered preview of the main model file.\n");
    }

    let request = AiRequest {
        subject,
        system: SYSTEM_PROMPT.to_string(),
        text,
        image_png,
        schema: suggestion_schema(),
        max_tokens: MAX_TOKENS,
    };

    // cache key: everything that influences the answer
    let mut h = Sha256::new();
    h.update(SCHEMA_VERSION.to_le_bytes());
    h.update(model.as_bytes());
    h.update(b"\0");
    h.update(request.system.as_bytes());
    h.update(b"\0");
    h.update(request.text.as_bytes());
    h.update(b"\0");
    if let Some(png) = &request.image_png {
        h.update(png);
    }
    let key = format!("{:x}", h.finalize());
    let cache_path = cache_dir(data_dir).join(format!("{key}.json"));
    let cached = std::fs::read_to_string(&cache_path)
        .ok()
        .and_then(|t| serde_json::from_str::<MetadataSuggestion>(&t).ok())
        .map(|mut s| {
            s.cached = true;
            s.sent = sent.clone();
            s
        });

    Ok(PreparedSuggestion {
        request,
        cache_path,
        vocabulary,
        sent,
        cached,
    })
}

pub fn cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("ai-cache")
}

/// Calls the provider (unless the answer is cached), validates the answer against the
/// schema rules and stores it in the cache.
pub fn run_suggestion(prepared: PreparedSuggestion, provider: &dyn AiProvider) -> Result<MetadataSuggestion> {
    if let Some(cached) = prepared.cached {
        return Ok(cached);
    }
    let answer = provider.complete(&prepared.request)?;
    let mut suggestion = validate(answer.json, &prepared.vocabulary)?;
    suggestion.model = answer.model;
    suggestion.sent = prepared.sent;
    if let Some(dir) = prepared.cache_path.parent() {
        std::fs::create_dir_all(dir).map_err(io_err(dir))?;
    }
    let text = serde_json::to_string(&suggestion).map_err(|e| EngineError::Serde(e.to_string()))?;
    let tmp = prepared.cache_path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(io_err(&tmp))?;
    std::fs::rename(&tmp, &prepared.cache_path).map_err(io_err(&prepared.cache_path))?;
    Ok(suggestion)
}

fn clean(v: Option<String>, max_chars: usize) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).map(|s| {
        if s.chars().count() > max_chars {
            s.chars().take(max_chars).collect()
        } else {
            s
        }
    })
}

/// Turns the model's JSON into a suggestion the UI can show: unknown fields are ignored,
/// bad values dropped, and only `KNOWN_LICENSES` pass.
pub fn validate(json: serde_json::Value, vocabulary: &[String]) -> Result<MetadataSuggestion> {
    if !json.is_object() {
        return Err(EngineError::AiInvalidResponse("answer is not a JSON object".into()));
    }
    let raw: RawSuggestion =
        serde_json::from_value(json).map_err(|e| EngineError::AiInvalidResponse(format!("answer does not match the schema: {e}")))?;
    let mut tags: Vec<String> = raw
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty() && t.chars().count() <= 40)
        .collect();
    let mut seen = std::collections::BTreeSet::new();
    tags.retain(|t| seen.insert(t.clone()));
    tags.truncate(MAX_TAGS);
    let new_tags = tags.iter().filter(|t| !vocabulary.contains(t)).cloned().collect();
    let license = clean(raw.license, 40)
        .filter(|l| KNOWN_LICENSES.iter().any(|k| k.eq_ignore_ascii_case(l)))
        .map(|l| {
            KNOWN_LICENSES
                .iter()
                .find(|k| k.eq_ignore_ascii_case(&l))
                .map(|k| k.to_string())
                .unwrap_or(l)
        });
    Ok(MetadataSuggestion {
        title: clean(raw.title, 120),
        creator: clean(raw.creator, 80),
        license,
        description: clean(raw.description, 1000),
        tags,
        new_tags,
        model: String::new(),
        cached: false,
        sent: AiSent::default(),
    })
}

/// A tiny request that proves the key, endpoint and model work together.
pub fn test_request() -> AiRequest {
    AiRequest {
        subject: "connection test".into(),
        system: "Answer with JSON only.".into(),
        text: "Reply with {\"ok\": true}.".into(),
        image_png: None,
        schema: serde_json::json!({ "type": "object", "properties": { "ok": { "type": "boolean" } }, "required": ["ok"], "additionalProperties": false }),
        max_tokens: 32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_cleans_tags_and_licenses() {
        let s = validate(
            serde_json::json!({ "title": "  Bin  ", "creator": "", "license": "cc-by-4.0", "description": null, "tags": ["Gridfinity", " bin", "bin", "", "x".repeat(50)], "extra": 1 }),
            &["bin".into()],
        )
        .unwrap();
        assert_eq!(s.title.as_deref(), Some("Bin"));
        assert_eq!(s.creator, None);
        assert_eq!(s.license.as_deref(), Some("CC-BY-4.0"));
        assert_eq!(s.tags, vec!["gridfinity", "bin"]);
        assert_eq!(s.new_tags, vec!["gridfinity"]);
        let unknown = validate(serde_json::json!({ "license": "WTFPL", "tags": [] }), &[]).unwrap();
        assert_eq!(unknown.license, None);
        assert!(matches!(
            validate(serde_json::json!([1, 2]), &[]),
            Err(EngineError::AiInvalidResponse(_))
        ));
    }

    #[test]
    fn settings_normalize_base_url() {
        let s = AiSettings {
            provider: AiProviderKind::Anthropic,
            base_url: Some(" http://localhost:11434/ ".into()),
            model: " ".into(),
        }
        .normalized()
        .unwrap();
        assert_eq!(s.base_url.as_deref(), Some("http://localhost:11434"));
        assert_eq!(s.model, DEFAULT_MODEL);
        assert_eq!(AiSettings::default().effective_base_url(), DEFAULT_BASE_URL);
        assert!(AiSettings {
            base_url: Some("ftp://x".into()),
            ..AiSettings::default()
        }
        .normalized()
        .is_err());
    }

    #[test]
    fn mock_modes_parse() {
        assert_eq!(MockMode::parse("1"), Some(MockMode::Ok));
        assert_eq!(MockMode::parse("Unauthorized"), Some(MockMode::Unauthorized));
        assert_eq!(MockMode::parse("nope"), None);
    }
}
