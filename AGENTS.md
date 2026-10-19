# Working on Meshkeep (for coding agents and humans)

Read `docs/README.md` first; the spec (`docs/spec/`) and the decisions (`docs/decisions/`)
are binding. This file is the operating manual.

## Stack

- **Shell:** Tauri 2 (`src-tauri/`), Rust 2021. Commands are thin wrappers over the engine.
- **Engine:** `crates/engine` (`meshkeep-engine`), shell-agnostic. Scanner, sidecars, SQLite
  index with FTS5, watcher, hashing, 3MF inspection, thumbnail cache bookkeeping, favorites
  (`collections.json`), rename and trash-delete. No Tauri imports allowed here.
- **Frontend:** React 19 + TypeScript + Vite 7, Tailwind CSS 4, shadcn-style components in
  `src/components/ui` (copied source, Radix primitives), TanStack Query + Virtual, zustand,
  i18next, Three.js. Visual direction D "Gallery" (ADR-0002); tokens in `src/styles/globals.css`.
- **Tests:** `cargo test` (engine), Vitest (`tests/unit`), Playwright UI tests in browser
  mode against the mock backend (`tests/ui`), WebdriverIO E2E against the real app in test
  mode (`tests/e2e`).

## Commands

```bash
npm ci                      # .npmrc sets legacy-peer-deps (npm 10 peer-resolution bug)
npm run tauri:dev           # app with hot reload
npm run dev                 # frontend only, browser mode with the mock backend (http://localhost:1420)
cargo test                  # engine + shell crates
npm run typecheck && npm test
npx vite build && npm run test:ui          # Playwright UI tests (needs `npx playwright install chromium` once)
npm run tauri:build:e2e && npm run test:e2e   # real-app E2E (Windows/macOS/Linux+Xvfb)
npm run tauri:build:store && ./msix/build-msix.ps1 && ./msix/sideload-test.ps1   # Windows: MSIX round trip
```

Build flavors are cargo features on `src-tauri`: none (dev), `e2e` (WebDriver plugins +
test seams), `updater` (private builds; `tauri.updater.conf.json` = stable channel,
`tauri.updater.dev.conf.json` = dev channel), `store` (Microsoft Store, never with the
updater). Every push to `main` or a working branch publishes a self-updating dev build
to the `dev` pre-release (`dev-channel.yml`, newest push wins); `docs/store/README.md` has the whole pipeline.

## Rules that are not negotiable (from the spec)

1. **Scanning never writes.** `project.yaml` is created on the user's first edit only.
2. **Sidecar writes are atomic and conflict-checked.** Pass the `sidecar_stamp` you read;
   handle `sidecar_conflict` in the UI (reload or overwrite, user's choice).
3. **Offline roots keep their projects.** Never delete index rows because a path is missing.
4. **The frontend never touches the file system.** Everything goes through engine commands
   with explicit capabilities; no `fs` plugin exposure.
5. **Every user-facing string goes through `t()`**, and `de.json` mirrors `en.json`
   (a unit test enforces parity).
6. **Heavy work stays off the UI thread:** geometry parsing and thumbnail rendering in Web
   Workers (main-thread fallback only where a webview has no WebGL in workers), hashing and
   scanning in Rust. Render the viewport on demand, not in a free-running loop.
7. **Stable selectors:** interactive elements that tests touch carry `data-testid`.
8. **Deletes go to the OS trash** (`trash` crate), never `remove_dir_all`, and only after a
   confirmation in the UI. Tests inject a plain remover via `Engine::set_deleter`.
9. **Imports write only after confirmation.** `analyze_import` is read-only; `execute_import`
   validates every target (name rules, collisions) before the first byte is written.
   `_Inbox` and `_Originals` below a root belong to the app and are never projects.
10. **Thumbnails are a cache, never library content.** PNGs live in `<data dir>/thumbs/`,
   keyed per project + source file, invalidated by source size/mtime (see
   `docs/spec/02-domain-model.md`). The frontend reads them through `read_thumbnail` only.

## Definition of done for a backlog item

A feature is done when its acceptance criteria are verified by an automated test at the
right level, and all of these pass locally:

- `cargo fmt --all --check && cargo clippy -p meshkeep-engine --all-targets -- -D warnings && cargo test`
- `npm run typecheck && npm test && npx vite build && npm run test:ui`
- For anything touching the shell or disk behaviour: `npm run test:e2e` against a fresh
  e2e build (CI runs it on Windows; locally on Linux use `xvfb-run`).

Add or extend tests in the same change. Prefer the cheapest level that proves the
behaviour: engine unit test > UI test in browser mode > real-app E2E.

## Test mode (real app)

`--test-mode` or `MESHKEEP_TEST_MODE=1` isolates app data (`MESHKEEP_DATA_DIR` or a temp
dir), seeds and scans `MESHKEEP_FIXTURE_ROOT` if set, and lets `MESHKEEP_PICK_FOLDER`
answer the native folder picker and `MESHKEEP_PICK_FILES` (`;`-separated) the import
picker. `fixtures/import` holds a bundle zip and a loose STL for import tests.
`fixtures/library` is the deterministic sample library:
tiny ASCII STLs, an OBJ, a PrusaSlicer-style 3MF with an embedded preview, one proper
sidecar, one malformed sidecar, one nested sidecar, an attachment, ignored files.
Browser mode (`npm run dev`, Playwright) uses the mock backend, which synthesizes STL, OBJ,
3MF and image bytes so parsers, viewer and the thumbnail pipeline run for real there too.

## Conventions

- Rust: `rustfmt` defaults, clippy clean, `thiserror` enums, no `unwrap` outside tests
  except on mutex locks. Return typed errors; the shell maps them to `AppError { code }`.
- TypeScript: strict, no `any`, named exports, components in PascalCase files, hooks in
  `use*`. Types in `src/lib/types.ts` mirror the Rust structs field by field; the next
  change that extends the command API switches this to generated types (`tauri-specta`).
- Tooling: Claude Code is the primary agent, Copilot secondary; both follow this file.
  Package manager is npm (lockfile committed).
- Commits: imperative subject, body explains why. Keep the spike (`spike/`) untouched; it
  is reference material until Epic 3 replaces it.
- Do not add dependencies without a line in the PR description saying why.
- License: PolyForm Noncommercial 1.0.0 (`LICENSE`, required notice in `NOTICE`); the Store build ships under the
  copyright holder's own terms. New dependencies must be permissively licensed (MIT,
  Apache-2.0, BSD, ISC, MPL-2.0 file-level); no GPL/AGPL/LGPL-static, no "noncommercial"
  third-party code. External contributions fall under the grant in `CONTRIBUTING.md`.

## Where things are

| Area | Path |
|---|---|
| Spec, backlog, ADRs, mockups, click dummy | `docs/` |
| Engine | `crates/engine/src/{scan,sidecar,index,watch,roots,collections,import,threemf,thumbs,engine}.rs` |
| Import staging, inbox, collections UI | `src/features/import/`, `src/features/library/{InboxView,CollectionDialogs}.tsx` |
| MSIX packaging, Store docs | `msix/`, `docs/store/` |
| Shell commands and events | `src-tauri/src/{commands,state}.rs` |
| Backend facade (Tauri vs mock) | `src/lib/backend/` |
| Mesh parsers (STL, OBJ, 3MF) and workers | `src/lib/mesh/`, `src/workers/{mesh,thumb}-worker.ts` |
| Thumbnail pipeline (queue, renderer, object-URL cache) | `src/lib/thumbs/` |
| Screens | `src/features/{welcome,library,project,settings}` |
| Design tokens | `src/styles/globals.css` |
| i18n | `src/i18n/{en,de}.json` |
| Tests | `tests/{unit,ui,e2e}`, `crates/engine/tests` |
| CI | `.github/workflows/ci.yml` (spike has its own workflow) |
