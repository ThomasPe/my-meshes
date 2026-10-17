# Product Backlog

Derived from the specification in `docs/spec/`. Technology-neutral: items reference
requirement IDs (LIB-1, META-2, …) rather than libraries. Concrete tooling is decided in
`docs/decisions/` and fills in the "Scaffold" epic once chosen.

Legend: every item is done only when its acceptance criteria are verified by an
automated end-to-end check against the real desktop app (see `spec/04-quality.md`).

## Phase 0: Decisions & mockups (current)

- [x] Archive the previous implementation (`archive/electron-v1`).
- [x] Consolidate the specification into `docs/spec/`.
- [x] Answer Q1, Q2, Q20 (Windows first, Store release, drag-out low priority).
- [ ] Answer Q21 (Rust in the stack?) and the remaining items in `docs/open-questions.md`.
- [ ] Decide the application shell (ADR-0001), including a short de-risking spike if
      Tauri is chosen.
- [ ] Decide UI framework and visual direction (ADR-0002) from the HTML mockups.

## Phase 1: MVP, a local library manager with read, write and preview

### Epic 1: Scaffold & foundation
- [ ] **Project scaffold.** Dev server with hot reload, production build, packaged
      installer for every target platform.
- [ ] **Test harness.** Unit test runner; E2E runner that launches the real app in
      deterministic test mode with fixture libraries; artifacts (screenshots, traces,
      logs) on failure; smoke test "window becomes interactive".
- [ ] **Agent workflow.** Documented loop: change, run targeted E2E, inspect artifacts,
      fix, rerun. `AGENTS.md` with the rules from the spec.
- [ ] **UI foundation.** Design tokens (light/dark), base components, app layout shell
      (sidebar, main, detail panel, status bar), i18n wiring with en + de.
- [ ] **Data foundation.** Embedded index database with full-text search; typed API
      between UI and backend with explicit capabilities; structured logging to file.
- [ ] **CI.** Lint, unit and E2E on push; installers built for all platforms on tag.
- [ ] **Auto-update** (APP-9) for private builds; disabled in Store builds.
- [ ] **MSIX packaging** (APP-11) with a Store-compatible manifest; Partner Center identity.

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
