# Open Questions

Collected while consolidating the specification. Answers are folded into the spec; this
file keeps the record of what was decided and when.

## Answered

| # | Question | Answer | Folded into |
|---|---|---|---|
| Q1 | Platform priority | **Windows first**, macOS stretch goal, Linux out of scope for v1 (2026-10-17). | `spec/01-vision.md`, `spec/03-features.md` APP-1, `spec/04-quality.md` |
| Q2 | Audience and distribution | **Private use first**, then Microsoft Store; Mac App Store stretch goal (2026-10-17). | `spec/03-features.md` APP-9/APP-11, `spec/04-quality.md` |
| Q3 | Library scale | **10,000 projects / 100,000 files / 500 MB single model** as design targets (2026-10-18). | `spec/04-quality.md` Performance |
| Q4 | Sidecar schema | `project.yaml` stays; `schema` stays; printing block = material, supports, notes; per-file `quantity` stays (2026-10-18). | `spec/02-domain-model.md` |
| Q5 | Thumbnail default | **App data cache** by default; per-project `.cache` as an option (2026-10-18). | `spec/02-domain-model.md` Thumbnails |
| Q6 | Inbox vs. staging | Staging is the review workflow; `_Inbox` is a folder below the root with its own view and promote action (2026-10-18). | `spec/02-domain-model.md`, `spec/03-features.md` IMP-3 |
| Q7 | Archive after import | Keep as attachment by default; `_Originals` or Recycle Bin as settings (2026-10-18). | `spec/02-domain-model.md`, `spec/03-features.md` IMP-2 |
| Q8 | Enrichment sources | Printables and Thingiverse first (APIs), MakerWorld/Thangs via public page data only; `source_url` canonical plus optional `source {platform,id}` (2026-10-18). | `spec/02-domain-model.md`, `spec/03-features.md` META-7 |
| Q9 | Collections location | App data (2026-10-18). | `spec/02-domain-model.md` Collections store |
| Q10 | Project boundary | Option c: first directory with model files or sidecar; nested sidecars are notes (2026-10-18). | `spec/02-domain-model.md` Project |
| Q11 | Model formats | Preview STL/OBJ/3MF; STEP/PLY/AMF indexed as models; slicer 3MF = model + badge (2026-10-18). | `spec/02-domain-model.md`, `spec/03-features.md` VIEW-2 |
| Q13 | Languages | English and German at launch (2026-10-18). | `spec/03-features.md` APP-3 |
| Q14 | Frameless window | No; native title bar (2026-10-18). | `spec/03-features.md` APP-10 |
| Q16 | License | **MIT** (2026-10-18). | `LICENSE` |
| Q17 | Agent tooling | Claude Code primary, Copilot secondary, both via `AGENTS.md`; npm stays (2026-10-18). | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` |
| Q18 | MVP definition | Three deliveries: walking skeleton, daily driver, Store-ready (2026-10-18). | `docs/backlog.md` Phase 1 |
| Q20 | Drag-out to slicer | Nice to have, very low priority (2026-10-17). | `spec/03-features.md` IMP-6 |
| Q21 | Rust in the stack? | Yes, Tauri 2 (2026-10-17). | `decisions/0001-tech-stack.md` |
| Q22 | Rescan granularity | Whole-root rescan on watcher events is acceptable for now; project-granular rescan is a later optimization (2026-10-18). | `spec/04-quality.md` Performance |
| Q23 | Rust to TypeScript types | Hand-mirrored for now; switch to `tauri-specta` with the next API extension (2026-10-18). | `AGENTS.md` Conventions |

## Open

- **[Q15] Name and branding.** Repository says "My Meshes", the mockup said "Hyperion
  3D". The name must be reserved in Partner Center before the Store release; the app
  identifier (`de.devsym.mymeshes`), window title and Store listing follow from it.
  Brainstorm in progress.
