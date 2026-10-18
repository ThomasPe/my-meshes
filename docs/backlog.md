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
- [ ] Answer the remaining items in `docs/open-questions.md` (Q4, Q5, Q10 before
      Epic 2; Q15 before the Store listing).

## Phase 1: MVP, a local library manager with read, write and preview

`[~]` = partially done, see the note.

Decided (Q18): phase 1 ships in three deliveries. **D1 Walking skeleton** (done: roots,
scan, grid and list, search, tags, inspector, STL viewer, settings). **D2 Daily driver**
(rendered thumbnails, 3MF and OBJ preview, favorites and recent imports, poll mode, safe
delete, rename): after D2 the author's real library goes live on it. **D3 Store-ready**
(import with staging and inbox, collections and smart collections, onboarding, MSIX
pipeline with the updater disabled, Store assets).

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
- [ ] **Auto-update** (APP-9) via `tauri-plugin-updater` with signed manifests for
      private builds; compiled out of Store builds.
- [ ] **MSIX packaging** (APP-11): scripted `MakeAppx` + `AppxManifest.xml` in CI with
      a Partner-Center-matching identity; side-load test on a clean VM.

### Epic 2: Library engine
- [x] **Library roots** (LIB-1).
- [x] **Scanner** (LIB-2): recursive, ignore list, never writes.
- [~] **Watcher** (LIB-3) done (debounced, whole-root rescan); **poll mode** (LIB-4) is a
      setting without a timer yet.
- [x] **Offline handling** (LIB-5).
- [ ] **Sync status & background activity** (LIB-6, LIB-7, APP-7).
- [x] **Sidecar read/write** (META-1..4): parsing, lazy creation, optimistic save,
      conflict detection with reload/overwrite dialog.
- [ ] **Project rename = directory rename** (META-5).

### Epic 3: Preview & thumbnails
- [~] **3D viewport** (VIEW-1): STL via worker, render on demand; OBJ and progressive
      loading pending.
- [ ] **3MF support** (VIEW-2): geometry, embedded thumbnail, metadata.
- [ ] **Thumbnail queue** (VIEW-3) with configurable storage location.
- [ ] **Image viewer & open-with-OS** (VIEW-5).
- [ ] **GPU fallback** (VIEW-6).

### Epic 4: Browsing & organization
- [~] **Sidebar navigation** (NAV-1): roots, folder tree and tags; Recent/Favorites/Inbox
      views pending.
- [x] **Grid view** (NAV-2) virtualized with zoom slider.
- [x] **List view** (NAV-3) with sortable columns.
- [~] **Search & filters** (NAV-4 done via FTS5; NAV-5 tags and folders done, other
      attributes pending).
- [x] **Detail view** (NAV-6): inspector and project page.
- [ ] **Collections & smart collections** (NAV-7, NAV-8) persisted in `collections.json`.

### Epic 5: Import & file operations
- [ ] **Staging area & archive import** (IMP-1, IMP-2).
- [ ] **Inbox** (IMP-3).
- [ ] **Passive sync of OS drops; archives as attachments** (IMP-4).
- [ ] **Safe delete to trash** (IMP-5).
- [ ] **Drag-out to other applications** (IMP-6).

### Epic 6: Settings
- [~] **Settings module** (APP-4): roots, sync mode, ignore patterns, theme, language
      done; thumbnail location, intervals and notifications pending.

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
