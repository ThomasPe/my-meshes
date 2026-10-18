# Working on Meshkeep (for coding agents and humans)

Read `docs/README.md` first; the spec (`docs/spec/`) and the decisions (`docs/decisions/`)
are binding. This file is the operating manual.

## Stack

- **Shell:** Tauri 2 (`src-tauri/`), Rust 2021. Commands are thin wrappers over the engine.
- **Engine:** `crates/engine` (`meshkeep-engine`), shell-agnostic. Scanner, sidecars, SQLite
  index with FTS5, watcher, hashing. No Tauri imports allowed here.
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
```

## Rules that are not negotiable (from the spec)

1. **Scanning never writes.** `project.yaml` is created on the user's first edit only.
2. **Sidecar writes are atomic and conflict-checked.** Pass the `sidecar_stamp` you read;
   handle `sidecar_conflict` in the UI (reload or overwrite, user's choice).
3. **Offline roots keep their projects.** Never delete index rows because a path is missing.
4. **The frontend never touches the file system.** Everything goes through engine commands
   with explicit capabilities; no `fs` plugin exposure.
5. **Every user-facing string goes through `t()`**, and `de.json` mirrors `en.json`
   (a unit test enforces parity).
6. **Heavy work stays off the UI thread:** geometry parsing in Web Workers, hashing and
   scanning in Rust. Render the viewport on demand, not in a free-running loop.
7. **Stable selectors:** interactive elements that tests touch carry `data-testid`.

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
answer the native folder picker. `fixtures/library` is the deterministic sample library:
tiny ASCII STLs, one proper sidecar, one malformed sidecar, one nested sidecar, an
attachment, ignored files.

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

## Where things are

| Area | Path |
|---|---|
| Spec, backlog, ADRs, mockups, click dummy | `docs/` |
| Engine | `crates/engine/src/{scan,sidecar,index,watch,roots,engine}.rs` |
| Shell commands and events | `src-tauri/src/{commands,state}.rs` |
| Backend facade (Tauri vs mock) | `src/lib/backend/` |
| Screens | `src/features/{welcome,library,project,settings}` |
| Design tokens | `src/styles/globals.css` |
| i18n | `src/i18n/{en,de}.json` |
| Tests | `tests/{unit,ui,e2e}`, `crates/engine/tests` |
| CI | `.github/workflows/ci.yml` (spike has its own workflow) |
