# Open Questions

Collected while consolidating the specification. Each is referenced from the spec as
**[Q#]**. Answers should be folded back into the spec and the question removed.

## Answered

| # | Question | Answer (2026-10-17) | Folded into |
|---|---|---|---|
| Q1 | Platform priority | **Windows first.** macOS is a stretch goal. Linux is out of scope for v1. | `spec/01-vision.md`, `spec/03-features.md` APP-1, `spec/04-quality.md` |
| Q2 | Audience and distribution | **Private use first**, then a public **Windows release via the Microsoft Store**; a **Mac App Store** release is a stretch goal. | `spec/03-features.md` APP-9/APP-11, `spec/04-quality.md` Platform & distribution |
| Q20 | Drag-out to slicer | **Nice to have, very low priority.** Not an MVP requirement. | `spec/03-features.md` IMP-6 moved to Later |
| Q21 | Rust in the stack? | **Yes.** Tauri 2 with a Rust engine is accepted. | `decisions/0001-tech-stack.md` (accepted) |

- **[Q3] Library scale.** Roughly how many projects and files, and how large is the
  biggest single model you expect? (Drives indexing design and streaming requirements.)

## Data model

- **[Q4] Sidecar schema.** Is the proposed `project.yaml` (see `spec/02-domain-model.md`)
  what you want? Specifically: the file name (`project.yaml` vs. something more
  specific like `.mymeshes.yaml`), a `schema` version field, the `printing` fields you
  actually care about (material, supports, layer height, infill, print time, nozzle?),
  and whether per-file `quantity` is useful.
- **[Q5] Thumbnail default.** The spec offers three storage locations and defaults to a
  hidden `.cache` folder inside every project. Confirm the default. Note that hidden
  folders inside projects show up when projects are zipped or shared and may be
  undesirable on a NAS.
- **[Q9] Where do collections live?** App-data folder (survives cache rebuilds, but is
  per machine) or inside the library root (travels with the library, shareable between
  machines, but one file per root)?
- **[Q10] Project boundary heuristic.** Without a sidecar, which directory is "the
  project"? Options: (a) the deepest directory containing model files, (b) the highest
  directory below the root that contains model files anywhere beneath it, (c) a
  directory containing model files directly, with subdirectories becoming part of it
  only if they contain no model files themselves. Example: `Gridfinity/Bins/*.stl` and
  `Gridfinity/Lids/*.stl`: one project or two? And what should happen when a nested
  `project.yaml` is found: error badge, ignore the inner file, or treat as separate?
- **[Q11] Supported model formats.** Beyond STL/OBJ/3MF: STEP, PLY, GLTF, AMF, SCAD,
  Blender/Fusion sources? How should slicer project files (Bambu/Prusa `.3mf` with
  plates and print settings) be treated: as models, as "slicer projects" or both?

## Workflows

- **[Q6] Inbox vs. staging area.** The spec has both. Is the inbox simply the default
  target of the staging area for loose files, or a separate concept with its own view?
- **[Q7] Archive handling on import.** After extracting an imported archive into a new
  project: keep the original archive as an attachment inside the project, move it to a
  configurable "originals" folder, or trash it?
- **[Q8] Enrichment sources.** Which platforms should enrichment support first, and is
  it acceptable to scrape pages where no public API exists (Printables, MakerWorld)?
  This is phase 2 but influences how source URLs are stored.

## Shell & UX

- **[Q13] Languages at launch.** English and German? Others?
- **[Q14] Frameless window.** Is a custom title bar a hard requirement? It costs effort
  on every platform (macOS traffic lights, Linux window managers) and is harder in
  Tauri than in Electron. The Windows 11 mockup could also be achieved with the native
  title bar plus a custom tab strip below it.
- **[Q15] Name and branding.** Repository says "My Meshes", the mockup says "Hyperion
  3D". Which name, and is there a logo/colour you want to keep?
- **[Q16] License.** The archived code was MIT. Same for the rebuild?

## Process

- **[Q17] Agent tooling.** Which agents will work on this (Claude Code, Copilot, Cursor)?
  The repo previously carried Copilot instructions and vendored skills; a single
  `AGENTS.md` plus per-tool thin wrappers would avoid drift. Package manager preference
  (`npm`, `pnpm`, `bun`)?
- **[Q18] Definition of MVP.** The backlog is large for a phase 1. Is there a smaller
  "walking skeleton" you want first (e.g. roots + scan + grid + 3D preview + tag
  editing), with import/staging and collections in a second step?
