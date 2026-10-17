# 4. Non-functional Requirements & Quality

> Status: specification, technology-neutral.

## Performance

| Area | Target |
|---|---|
| Library size | 50,000 files / 10,000 projects without degraded interaction. **[Q3]** |
| Grid scrolling | 60 fps on a mid-range laptop; virtualized rendering |
| Search | Results within 100 ms for the sizes above |
| Startup | Interactive within 2 s with a warm index |
| Heavy work | Hashing, archive extraction, geometry parsing and thumbnail rendering run off the UI thread and are cancelable |
| Memory | Large meshes are streamed or chunked; the app must not exhaust memory on a 500 MB STL |

## Privacy & security

- No telemetry, no crash upload, no network access unless the user triggers an online
  feature (enrichment, update check).
- The UI layer has no direct file-system access; all disk operations go through a narrow,
  typed API with explicit capabilities.
- Only library roots and the app's own data directory are ever written to.
- Metadata files are written atomically; the app never leaves half-written sidecars.

## Reliability & data safety

- Deletions use the OS trash.
- Disconnected volumes never cause index deletions.
- The index is disposable and rebuildable; a corrupt index triggers a rebuild, not data
  loss.
- Every write to the library is logged.

## Platform & distribution

- **Windows 10 (1809+) / Windows 11, x64 and arm64** is the primary target. Public
  distribution through the Microsoft Store as an MSIX package; private builds as a
  signed installer or portable build with a self-updater.
- **macOS 13+** is a stretch goal, distributed through the Mac App Store. This implies
  the App Sandbox: file access only to user-picked folders persisted via security-scoped
  bookmarks, outbound network only with the client entitlement, upload as a signed `.pkg`.
- **Linux** is out of scope for v1; the architecture must not preclude it.
- GPU acceleration required for 3D preview; graceful fallback without it.
- Store builds must not ship their own updater; Store policy also expects the embedded
  runtime (browser engine, if any) to receive security updates, so the release cadence
  must keep up with the runtime's.

## Accessibility & i18n

- Keyboard-navigable throughout; visible focus states; sufficient contrast in both themes.
- All strings externalized; date, number and file-size formatting respect the locale.

## Testability: agent-driven verification

The project is developed largely by coding agents. Features count as done only when an
automated end-to-end check passes against the real desktop application.

- **Drive the real app.** E2E tests launch the packaged or dev build of the desktop app
  and interact with its window, not a browser-only rendering of the UI.
- **Deterministic test mode.** A dedicated test mode uses isolated app-data, cache and
  log directories, seeds fixture libraries (at least one valid root, one malformed
  sidecar, one offline root) and disables nondeterministic behavior such as update
  prompts.
- **Stable selectors.** Critical UI flows expose stable test identifiers.
- **Outcome assertions.** Tests assert the visible UI and the persisted side effects on
  disk (sidecars, renamed directories, trash) and in the index.
- **Failure evidence.** Failed runs keep screenshots, traces and application logs.
- **Smoke test.** A test proves the app launches and the first window becomes interactive
  on every supported platform in CI (Windows from day one; macOS when it becomes a target).
- **Narrow test seams.** Where OS dialogs or external applications cannot be automated,
  test mode exposes a seam (e.g. a preselected path) rather than skipping the check.

## Tooling baseline (technology-neutral)

- Unit tests for pure logic (parsers, query evaluation, path rules).
- Linting and formatting enforced in CI.
- CI runs lint, unit and E2E on every push; releases build installers for all target
  platforms.
- Developer, user and agent-workflow documentation kept in `docs/`.
