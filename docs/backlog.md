# Product Backlog

Derived from the specification in `docs/spec/`. Items reference requirement IDs (LIB-1,
META-2, …). The application shell is decided: **Tauri 2 with a Rust engine**
(ADR-0001). The visual direction is D Gallery (ADR-0002); the component library is confirmed during the scaffold.

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
- [ ] **0.5 Click dummy review.** Walk through `docs/clickdummy/index.html` on all screens; collect changes to layout, wording and flows before the spike. Confirm the component library (Mantine default) during the scaffold.
- [ ] Answer the remaining items in `docs/open-questions.md` (Q4, Q5, Q10 before
      Epic 2; Q15 before the Store listing).

## Phase 1: MVP, a local library manager with read, write and preview

### Epic 1: Scaffold & foundation (Tauri 2 + Rust)
- [ ] **Repository layout.** Cargo workspace with `crates/engine` (shell-agnostic
      library) and `src-tauri` (commands, events, capabilities); `src/` Vite +
      TypeScript frontend; `pnpm` or `npm` decided in Q17. `tauri dev` gives hot
      reload; `tauri build` produces the NSIS installer.
- [ ] **Engine skeleton.** Crate with modules for roots, scan, watch, index, sidecar,
      hash, archive; `cargo test` with fixture libraries under `fixtures/`. Candidate
      crates, to be verified at scaffold time: `notify` (+ polling backend), `rusqlite`
      with `bundled` and FTS5, `sha2` + `rayon`, `zip`, a maintained serde YAML crate,
      `walkdir`/`ignore` for scanning with glob ignores, `trash` for safe delete.
- [ ] **Typed API.** Commands and events defined once (Rust structs with `serde`,
      TypeScript types generated, e.g. via `specta`/`tauri-specta`); every command
      covered by a Tauri capability; no `fs` plugin exposure to the frontend beyond
      what registered roots need.
- [ ] **Test harness.** Vitest for frontend logic; Playwright against the UI in a
      browser with a mocked API; WebdriverIO + `tauri-driver` launching the real app in
      a deterministic test mode (`--test-mode` flag: temp app-data, fixture roots,
      updater off); failure artifacts (screenshots, logs, engine trace) kept; smoke
      test "window becomes interactive".
- [ ] **Agent workflow.** `AGENTS.md` with the rules from the spec, the test loop
      (change, run targeted tests, inspect artifacts, fix, rerun) and the Rust/TS
      conventions; thin per-tool wrappers (Copilot, Claude Code) pointing at it.
- [ ] **UI foundation.** Port the click dummy's tokens and shell (sidebar, main,
      inspector, status bar) to the chosen component library; light/dark/system; i18n
      wiring with en + de.
- [ ] **Logging.** Structured logging from engine and frontend to a rotating file in
      app-data (`tauri-plugin-log` or `tracing` + file appender).
- [ ] **CI.** GitHub Actions on `windows-latest`: `cargo clippy`/`cargo test`, lint,
      Vitest, Playwright (browser), WebDriver smoke; NSIS installer artifact on tag.
- [ ] **Auto-update** (APP-9) via `tauri-plugin-updater` with signed manifests for
      private builds; compiled out of Store builds.
- [ ] **MSIX packaging** (APP-11): scripted `MakeAppx` + `AppxManifest.xml` in CI with
      a Partner-Center-matching identity; side-load test on a clean VM.

### Epic 2: Library engine
- [ ] **Library roots** (LIB-1).
- [ ] **Scanner** (LIB-2): recursive, ignore list, never writes.
- [ ] **Watcher** (LIB-3) and **fallback sync modes** (LIB-4).
- [ ] **Offline handling** (LIB-5).
- [ ] **Sync status & background activity** (LIB-6, LIB-7, APP-7).
- [ ] **Sidecar read/write** (META-1..4): parsing, lazy creation, optimistic save,
      conflict detection.
- [ ] **Project rename = directory rename** (META-5).

### Epic 3: Preview & thumbnails
- [ ] **3D viewport** (VIEW-1) for STL/OBJ with progressive loading off the UI thread.
- [ ] **3MF support** (VIEW-2): geometry, embedded thumbnail, metadata.
- [ ] **Thumbnail queue** (VIEW-3) with configurable storage location.
- [ ] **Image viewer & open-with-OS** (VIEW-5).
- [ ] **GPU fallback** (VIEW-6).

### Epic 4: Browsing & organization
- [ ] **Sidebar navigation** (NAV-1) incl. folder tree.
- [ ] **Grid view** (NAV-2) virtualized with zoom slider.
- [ ] **List view** (NAV-3) with sortable columns.
- [ ] **Search & filters** (NAV-4, NAV-5).
- [ ] **Detail view** (NAV-6).
- [ ] **Collections & smart collections** (NAV-7, NAV-8) persisted in `collections.json`.

### Epic 5: Import & file operations
- [ ] **Staging area & archive import** (IMP-1, IMP-2).
- [ ] **Inbox** (IMP-3).
- [ ] **Passive sync of OS drops; archives as attachments** (IMP-4).
- [ ] **Safe delete to trash** (IMP-5).
- [ ] **Drag-out to other applications** (IMP-6).

### Epic 6: Settings
- [ ] **Settings module** (APP-4): roots, ignore patterns, thumbnail location, sync
      intervals, theme, language, notifications.

## Phase 2: Quality of life

### Epic 7: Metadata & hygiene
- [ ] **Duplicate detection** (LIB-8).
- [ ] **Batch editing** (META-6).
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
