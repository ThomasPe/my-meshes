# Product Backlog

Derived from the specification in `docs/spec/`. Items reference requirement IDs (LIB-1,
META-2, …). The application shell is decided: **Tauri 2 with a Rust engine**
(ADR-0001). The visual direction is D Gallery with shadcn/ui on Tailwind 4 (ADR-0002).

Legend: every item is done only when its acceptance criteria are verified by an
automated end-to-end check against the real desktop app (see `spec/04-quality.md`).

## Phase 0: Decisions & mockups (current)

- [x] Archive the previous implementation (`archive/electron-v1`).
- [x] Consolidate the specification into `docs/spec/`.
- [x] Answer Q1, Q2, Q20, Q21 (Windows first, Store release, drag-out low priority,
      Rust welcome).
- [x] Decide the application shell: Tauri 2 + Rust engine (ADR-0001 accepted).
- [x] **0.4 De-risking spike (Windows CI):** `spike/` + `.github/workflows/spike-windows.yml`.
      All four checks passed on `windows-latest` (run 1, 2026-10-17): (a) 1,002,528-triangle
      STL loads in WebView2, (b) 20 thumbnails rendered in a Web Worker via OffscreenCanvas
      and written by Rust, (c) WebdriverIO E2E against the real app passes, (d) MSIX built,
      signed, side-loaded, launched and removed. Details in ADR-0001 "Spike results".
- [x] **0.4b Spike on real hardware** (2026-10-18, Intel Iris Xe): 120 fps orbiting the
      1M-triangle mesh, 20 thumbnails in 660 ms with a 20 ms worst UI frame gap, all
      verdicts pass. Table in ADR-0001.
- [x] Decide visual direction: D Gallery (ADR-0002 accepted).
- [x] **0.5 Click dummy review:** accepted as is. Component library decided: shadcn/ui + Tailwind 4 (ADR-0002).
- [x] Answer the remaining items in `docs/open-questions.md` (all decided 2026-10-18;
      name: Meshkeep).

## Phase 1: MVP, a local library manager with read, write and preview

`[~]` = partially done, see the note.

Decided (Q18): phase 1 ships in three deliveries. **D1 Walking skeleton** (done: roots,
scan, grid and list, search, tags, inspector, STL viewer, settings). **D2 Daily driver**
(done 2026-10-18: rendered thumbnails with a background queue and cache, 3MF and OBJ
preview, slicer-3MF badge with embedded preview, favorites and recent additions, poll
mode with intervals, safe delete to trash, rename): the author's real library can go live
on it. **D3 Store-ready** (done 2026-10-19: import with staging and inbox, collections and
smart collections, onboarding, MSIX pipeline with the updater compiled out of Store
builds, self-updater for private builds, release workflow, Store assets and listing
texts). **D4 polish** (done 2026-10-19: image viewer, per-root sync status, 7z import,
creator filter, multi-selection actions). **D5 close-out** (done 2026-10-19: attribute
filters for license, material and file type, batch tag/creator edits, progressive loading in
the viewer, previews optionally inside the project folder, OS notifications, and the
scanner settings finally persisted in `settings.json`). What remains before the first
submission is outside the code: Partner Center identity values, screenshots
(`docs/store/README.md`).

### Epic 1: Scaffold & foundation (Tauri 2 + Rust)
- [x] **Repository layout.** Cargo workspace with `crates/engine` (shell-agnostic
      library) and `src-tauri` (commands, events, capabilities); `src/` Vite +
      TypeScript frontend; `pnpm` or `npm` decided in Q17. `tauri dev` gives hot
      reload; `tauri build` produces the NSIS installer.
- [x] **Engine skeleton.** (archive/hash modules minimal; `notify-debouncer-full`, `rusqlite` bundled FTS5, `serde_yaml_ng`, `globset`, `walkdir` chosen) Crate with modules for roots, scan, watch, index, sidecar,
      hash, archive; `cargo test` with fixture libraries under `fixtures/`. Candidate
      crates, to be verified at scaffold time: `notify` (+ polling backend), `rusqlite`
      with `bundled` and FTS5, `sha2` + `rayon`, `zip`, a maintained serde YAML crate,
      `walkdir`/`ignore` for scanning with glob ignores, `trash` for safe delete.
- [x] **Typed API.** Commands and events over `serde` structs; TypeScript types mirrored by
      hand in `src/lib/types.ts` (generation via specta is a later refinement); no `fs`
      plugin exposed to the frontend; raw binary IPC for file reads.
- [x] **Test harness.** Vitest for frontend logic; Playwright against the UI in a
      browser with a mocked API; WebdriverIO + `tauri-driver` launching the real app in
      a deterministic test mode (`--test-mode` flag: temp app-data, fixture roots,
      updater off); failure artifacts (screenshots, logs, engine trace) kept; smoke
      test "window becomes interactive".
- [x] **Agent workflow.** `AGENTS.md`, with thin pointers for Copilot and Claude Code. `AGENTS.md` with the rules from the spec, the test loop
      (change, run targeted tests, inspect artifacts, fix, rerun) and the Rust/TS
      conventions; thin per-tool wrappers (Copilot, Claude Code) pointing at it.
- [x] **UI foundation.** Tokens and shell ported from the click dummy to Tailwind 4 +
      shadcn-style components; light/dark/system; i18n en + de with a parity test.
- [x] **Logging.** `tauri-plugin-log` to stdout and the app log dir. Structured logging from engine and frontend to a rotating file in
      app-data (`tauri-plugin-log` or `tracing` + file appender).
- [x] **CI.** `.github/workflows/ci.yml`: engine (fmt, clippy, test) and frontend
      (typecheck, Vitest, Playwright UI) on Linux; e2e build + WebDriver E2E + release
      build on Windows. Installer-on-tag still to do.
- [x] **Auto-update** (APP-9) via `tauri-plugin-updater` behind the `updater` cargo
      feature (private NSIS builds, manual check in settings); Store and dev builds do not
      compile it. Signing key setup documented in `docs/store/README.md`.
- [x] **MSIX packaging** (APP-11): `msix/` manifest, assets, `build-msix.ps1`
      (side-load self-signed or unsigned for Partner Center) and `sideload-test.ps1`;
      CI installs and launches the package on every push; `release.yml` attaches both
      MSIX flavors and the installer to a draft release on `v*` tags.

### Epic 2: Library engine
- [x] **Library roots** (LIB-1).
- [x] **Scanner** (LIB-2): recursive, ignore list, never writes.
- [x] **Watcher** (LIB-3) done (debounced, whole-root rescan); **poll mode** (LIB-4) with a
      per-root interval (1 min to 3 h) and a 30 s due-check in the shell.
- [x] **Offline handling** (LIB-5).
- [x] **Sync status & background activity** (LIB-6, LIB-7, APP-7): per-root last scan
      summary (counts, duration, trigger, scanner notes) and last sync problem in settings;
      status bar shows scans and preview rendering; toasts for scan/import results and
      watcher failures.
- [x] **Sidecar read/write** (META-1..4): parsing, lazy creation, optimistic save,
      conflict detection with reload/overwrite dialog.
- [x] **Project rename = directory rename** (META-5): Windows-safe name validation,
      collision check before touching disk, favorites and thumbnail follow the new id.

### Epic 3: Preview & thumbnails
- [x] **3D viewport** (VIEW-1): STL, OBJ and 3MF parsed in a worker, render on demand;
      binary STL streams in 100k-triangle slices with a progress bar, so a million-triangle
      file appears while it loads.
- [x] **3MF support** (VIEW-2): geometry incl. components and build transforms, embedded
      preview extracted by the engine, slicer detection (PrusaSlicer, Bambu/Orca) as a badge.
- [x] **Thumbnail queue** (VIEW-3): engine-driven queue, worker rendering with main-thread
      fallback, PNG cache in app data keyed per project + source file, invalidated by
      size/mtime; status bar progress; "clear cache" in settings. Optional location
      `<project>/.cache/thumbs` (setting), never indexed, cleared together with the app cache.
- [x] **Image viewer & open-with-OS** (VIEW-5): images tab with tiles and a lightbox
      (keyboard navigation, open with the OS app).
- [~] **GPU fallback** (VIEW-6): placeholders plus a status-bar notice when no WebGL is
      available anywhere; viewer shows a message instead of crashing.

### Epic 4: Browsing & organization
- [x] **Sidebar navigation** (NAV-1): roots, folder tree, tags, Recent additions,
      Favorites, Inbox per root, collections and smart collections.
- [x] **Grid view** (NAV-2) virtualized with zoom slider.
- [x] **List view** (NAV-3) with sortable columns.
- [x] **Search & filters** (NAV-4 via FTS5; NAV-5 tags, folders, creator, license,
      material and model file type as inspector facets with counts; all of them can be
      saved into a smart collection).
- [x] **Detail view** (NAV-6): inspector and project page.
- [x] **Collections & smart collections** (NAV-7, NAV-8) persisted in `collections.json`:
      create/rename/delete, add via context menu, remove, drag-to-reorder in the collection
      view; smart collections save the current search/tags/scope and evaluate live.

### Epic 5: Import & file operations
- [~] **Staging area & archive import** (IMP-1, IMP-2): native drop or picker opens the
      staging dialog; zips and folders become projects, loose files go to the inbox,
      archive policy keep/_Originals/trash with the space each costs. zip and 7z are
      extracted; rar is reported and routed to the inbox.
- [x] **Inbox** (IMP-3): `_Inbox` per root with its own view, promote-to-project, delete.
- [x] **Passive sync of OS drops; archives as attachments** (IMP-4): the watcher picks up
      files that appear on disk; archives inside projects stay opaque attachments.
- [x] **Safe delete to trash** (IMP-5): whole project or single file, confirmation dialog,
      `Delete` key; a project whose last model goes leaves the library.
- [ ] **Drag-out to other applications** (IMP-6).

### Epic 6: Settings
- [x] **Settings module** (APP-4): roots, sync mode with poll interval, ignore patterns,
      bundle folders, preview cache and location, OS notifications for background
      scans/imports, updates, theme, language. Engine settings persist in `settings.json`.

## Phase 2: Quality of life

### Epic 7: Metadata & hygiene
- [ ] **Duplicate detection** (LIB-8).
- [x] **Batch editing** (META-6): multi-selection can be favorited, added to a collection,
      deleted, tagged/untagged and given a creator in one engine call with a per-project
      failure report.
- [ ] **External enrichment** (META-7).
- [ ] **Organizational rules & maintenance tools** (IMP-7, IMP-8).

### Epic 8: Productivity
- [ ] **Project tabs** (NAV-9).
- [ ] **Dashboard** (NAV-10).
- [ ] **Keymap** (APP-5).
- [ ] **Undo/redo** (APP-6).
- [ ] **Log viewer** (APP-8).
- [ ] **Custom thumbnails** (VIEW-4).
- [ ] **Frameless title bar** (APP-10), if confirmed.

## Phase 3: Model tools
- [ ] **Transforms & mesh analysis** (VIEW-7).
