# ADR-0003: AI assistance with a user-supplied API key

- Status: **proposed** 2026-10-21 (brainstorm consolidated into candidate features, principles
  and a recommended first slice; no implementation yet).
- Date: 2026-10-21
- Related: ADR-0001 (engine is shell-agnostic, all I/O in Rust), `spec/01-vision.md`
  ("offline first, private by default"), `spec/04-quality.md` (no network access unless the
  user triggers an online action), backlog items META-7, LIB-8, IMP-7/8, VIEW-4, VIEW-7, NAV-10.

## Context

Most real libraries have little metadata: projects are named after the zip they came from,
carry no tags, no creator, no license, and the README from the download bundle is the only
description. Filling `project.yaml` by hand for thousands of projects does not happen.

A multimodal language model can read what the app already has (the rendered thumbnail,
the file list, the README, project images, the existing sidecar) and propose the missing
metadata, translate a natural-language question into a search, or spot near-duplicates
that content hashes miss. Meshkeep does not want to run or ship a model itself; the user
brings their own key ("BYOK") for a hosted provider, or points the app at a local server.

This ADR records the principles such a feature must follow to stay inside the vision, the
candidate features, and which slice to build first. It does not decide the provider.

## Principles (binding for every AI feature)

1. **Opt-in and user-triggered.** Nothing talks to a provider until the user has entered a
   key in settings, and every call is either an explicit action ("Suggest", "Ask") or a
   background job the user switched on in settings with a visible scope. The privacy rule
   in `spec/04-quality.md` stays intact: no key, no network.
2. **Suggestions, never silent writes.** AI output is shown as a diff with checkboxes and
   reaches disk only through the existing sidecar save (with `sidecar_stamp`), the import
   confirmation, or the rename/move commands. Rule 1 from `AGENTS.md` ("scanning never
   writes") extends to "AI never writes".
3. **Send little, say what is sent.** Inputs are the thumbnail PNG (downscaled, at most
   512 px), file names and sizes, the sidecar text, README and license text, project
   images on request. Model geometry (STL/OBJ/3MF bytes) is never uploaded. The dialog
   that triggers a call names what leaves the machine.
4. **Structured output, validated locally.** Every call requests JSON against a fixed
   schema (tags from the existing vocabulary plus a short list of new ones, SPDX license
   enum, boolean `supports_required`, …) and the engine validates it with `serde` before
   the UI sees it. Free text is limited to description and notes.
5. **Results are a cache, not library content.** Responses are cached in app data, keyed
   by a hash of the inputs, like thumbnails (rule 10). Losing the cache costs money, not
   data.
6. **Deterministic in test mode.** A mock provider returns canned answers so UI and E2E
   tests run without network, mirroring the mock backend in browser mode.
7. **Key storage.** The key goes into the OS credential store (`keyring` crate), never
   into `settings.json`, logs, feedback reports or the clipboard log tail.
8. **Engine owns the call.** The provider client lives in `crates/engine` behind a trait;
   the shell passes the key in and events out. No fetch from the frontend.

## Candidate features

Ordered by expected value for a hobbyist with a large, under-tagged library. Inputs
follow principle 3; "writes via" names the existing path the confirmed result takes.

| # | Feature | Inputs | Output | Writes via | Builds on |
|---|---|---|---|---|---|
| 1 | **Metadata suggestions** ("Suggest" in the inspector) | thumbnail, folder and file names, README, images, current sidecar | title, tags, description, creator, license (SPDX), category | sidecar save | META-1..4 |
| 2 | **Batch enrichment** for projects without tags or description | as 1, per project, with cost estimate up front | review list of per-project suggestions | batch edit (META-6) | 1, smart collections |
| 3 | **Import proposals** in the staging dialog | archive listing, README, license files, platform hints | normalized project name, creator, source platform, tags, target folder per IMP-7 rules | `execute_import` after confirmation | IMP-1, IMP-7 |
| 4 | **Natural-language search** | the query text only | a smart-collection query in the existing `{ all: [...] }` schema, executed locally | optional "save as smart collection" | NAV-4, NAV-8 |
| 5 | **Semantic search** via embeddings | sidecar text, file names, a one-line thumbnail description | vector per project in SQLite (`sqlite-vec`), nearest-neighbour search | index only | NAV-4 |
| 6 | **Near-duplicate detection** | thumbnail embeddings or pairwise vision calls on hash-distinct projects | candidate pairs with confidence | resolution flow of LIB-8 | LIB-8 |
| 7 | **Image understanding** | project photos | description, printed material/colour, part count, assembly hints, best image as thumbnail | sidecar save, VIEW-4 | VIEW-5 |
| 8 | **Print hints** | bounding box, triangle count, mesh-analysis flags (VIEW-7), thumbnail | orientation, supports, material, thin-wall warnings for the `printing` block | sidecar save | VIEW-7 |
| 9 | **README and license summary** in the documents tab | README, LICENSE text | print notes, parts list, SPDX guess | sidecar save | VIEW-5 |
| 10 | **File-name decoding** | file names, thumbnails per file | per-file `description` and `quantity` | sidecar `files:` block | META-1 |
| 11 | **Library chat** with tools | the conversation plus engine tools (search, read project, create collection, tag) | answers and proposed actions, each write confirmed | existing commands | all of the above |
| 12 | **Dashboard insights** (weekly) | aggregate counts only | short summary: new projects, untagged, license gaps, duplicate candidates | none | NAV-10 |
| 13 | **Metadata translation** | description text | translated text for the index or the sidecar | sidecar save | APP-3 |
| 14 | **Reorganization assistant** | project list with metadata | proposed folder layout with a preview of every move | rename/move commands (IMP-8) | IMP-7, IMP-8 |

Notes per feature:

- 1 and 4 share all the plumbing (key storage, provider trait, structured output, mock
  provider, cache) and are the clearest demonstrations of value. 2 and 3 are mostly UI
  on top of 1.
- 5 and 6 add an embeddings table to the index and a vector extension; they are the only
  candidates that touch the index schema.
- 8 risks overpromising: the model sees a picture and a few numbers, not the mesh. Hints
  must be worded as hints.
- 11 is the largest feature and the one with the highest risk of unintended writes; it
  belongs in phase 3 at the earliest and only with per-action confirmation.
- 12 and 13 are cheap and low-risk but also low on the list of what users ask for.

## Options for the provider layer

| Option | Pros | Cons |
|---|---|---|
| **A. Single hosted provider (Anthropic Messages API)** | one client, vision and structured output in one call, cheapest path to feature 1 | lock-in; users with other keys are excluded |
| **B. Provider trait with Anthropic first, OpenAI-compatible endpoints second** | covers most hosted keys; the trait keeps the engine honest about what it needs (describe image + text, return JSON) | two clients to maintain; capability differences (vision, JSON mode) leak into the trait |
| **C. B plus a local server (Ollama / OpenAI-compatible on localhost)** | no key, no data leaves the machine; aligns with "offline first" | local vision models are weaker; model management is the user's problem; must be clearly labelled as unsupported quality-wise |

Recommendation: **B, designed so that C is a configuration (base URL) rather than a new
client.** A key is optional when the base URL is local.

## Recommended first slice

Build feature **1 (metadata suggestions)** with the plumbing every later feature reuses
(revised 2026-10-22: natural-language search was dropped from the first slice and is the
first follow-up):

- Settings card "AI assistance": provider, base URL, key (stored in the credential
  store), a test button, and a plain statement of what is sent.
- Engine: `AiProvider` trait, Anthropic client, mock provider, response cache, typed
  errors (`ai_disabled`, `ai_unauthorized`, `ai_rate_limited`, `ai_invalid_response`).
- Inspector: "Suggest metadata" opens a diff dialog; accepted fields go through the
  normal save with conflict handling.
- Tests: engine unit tests against the mock provider (schema validation, cache hits,
  error mapping); UI tests in browser mode for the settings card and the suggestion
  dialog; one E2E test that the key is not in `settings.json` and that no call happens
  without a key.

Then 4 (natural-language search), 2 (batch enrichment) and 3 (import proposals) as
follow-ups on the same base.

## Consequences

- New dependencies in the engine: an HTTP client (`reqwest`, rustls), `keyring`; later
  possibly `sqlite-vec`. Each must be permissively licensed (see `AGENTS.md`).
- The Store listing and privacy statement must say that data is sent to a third party
  of the user's choice once a key is entered (`docs/store/`).
- Cost control is a product feature: estimate before batch runs, cap per run, cache by
  input hash, use the smallest model that fills the schema (Haiku-class for tagging).
- `settings.json` gains an `ai` block (provider, base URL, model, enabled background
  jobs) but never the key.
- Test mode gets a `MESHKEEP_AI_MOCK` seam so the real app runs E2E tests without
  network, like the folder picker seams.

## Open questions

Marked **[Q#]** in the spec once an implementation starts.

- Does background batch enrichment run at all, or stays everything explicit per project?
  A capped, user-started batch with a review list is the current assumption.
- Where do rejected suggestions go: remembered per project so they are not proposed
  again, or forgotten?
- Should the tag vocabulary be closed (only existing tags) by default, with "allow new
  tags" as an option in the dialog?
- Local provider (option C) in the first slice or later? Later is the assumption; the
  trait must not block it.
