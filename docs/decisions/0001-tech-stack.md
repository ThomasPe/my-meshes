# ADR-0001: Application shell and tech stack

- Status: **proposed**, awaiting answers to Q1, Q2, Q20 in `docs/open-questions.md`
- Date: 2026-10-17
- Supersedes: the Electron/Forge/React stack of `archive/electron-v1`

## Context

The first implementation used Electron + Electron Forge + React. Before rebuilding, the
question is whether Electron is still the right shell, with Tauri 2 as the obvious
challenger, and what else is on the table. The decision is driven by what *this* app
needs, not by general-purpose benchmarks.

### Requirements that actually discriminate between shells

| # | Requirement (spec ID) | Why it matters for the shell |
|---|---|---|
| R1 | Interactive WebGL 3D preview (VIEW-1) and thumbnail rendering (VIEW-3) | The renderer must have reliable, hardware-accelerated WebGL on every target OS |
| R2 | Background thumbnail generation that never blocks the UI (VIEW-3) | Needs offscreen/hidden rendering or a second rendering context |
| R3 | Native drag-out of files into slicers (IMP-6) | Needs OS-level drag sources, not HTML5 drag |
| R4 | Watch large local and network libraries (LIB-3, LIB-4) | Needs a robust file-watcher with polling fallback |
| R5 | Hashing, archive extraction, YAML parsing at scale (LIB-2, LIB-8, IMP-2) | CPU-heavy work off the UI thread |
| R6 | Embedded index with full-text search (NAV-4) | SQLite with FTS5 is the natural fit; how painful is it to ship? |
| R7 | Agent-driven E2E against the real app on all platforms (`spec/04-quality.md`) | The shell must be automatable from a test runner |
| R8 | OS trash, open-with, file dialogs, notifications (IMP-5, VIEW-5, APP-7) | Standard shell integrations |
| R9 | Auto-update with channels (APP-9) | Updater availability and signing workflow |
| R10 | Footprint: install size, idle memory, startup | Nice to have for a hobbyist desktop tool, not a hard requirement |
| R11 | Developer/agent productivity | One language vs. two, compile times, ecosystem depth, how well agents work in it |

## Options considered

### A. Electron (Chromium + Node.js)
Ships its own Chromium and Node. Current line: Electron 44 stable, 45 imminent (Oct 2026).

### B. Tauri 2 (system webview + Rust core)
Uses WebView2 (Chromium) on Windows, WKWebView on macOS, WebKitGTK on Linux. Rust
backend, capability-based IPC, rich official plugin set. Current line: 2.11.x.

### C. Wails v3 (system webview + Go)
Same webview model as Tauri with Go instead of Rust. v3 is still in beta (v2 remains
stable). Smaller ecosystem, no first-party updater story comparable to the others.

### D. Native UI toolkits (Avalonia/.NET, Flutter, Qt/QML, Compose Multiplatform)
No webview. Would mean giving up Three.js and the web UI ecosystem; 3D would need a
native engine binding. Strong for footprint and native feel, weak for R1 ecosystem,
R11 (agents are far more productive in web stacks) and for reusing anything from v1.

### E. Neutralino and similar lightweight shells
Minimal APIs, no serious story for R2, R3, R6, R7. Not a fit.

Options C, D and E are rejected; the real decision is **A vs. B**.

## Electron vs. Tauri against the requirements

| Req | Electron | Tauri 2 | Edge |
|---|---|---|---|
| R1 WebGL everywhere | One Chromium on all three OSes; identical rendering, WebGL2 and OffscreenCanvas guaranteed | Windows: WebView2 = Chromium, fine. macOS: WKWebView WebGL is fine but lags Chromium on features. **Linux: WebKitGTK is the weak link**; Tauri's own docs document GPU/driver mismatches (notably NVIDIA + DMABUF), WebGL silently falling back to slow paths, and masked renderer strings that make detection hard | **Electron**, strongly if Linux matters |
| R2 Offscreen thumbnails | Hidden `BrowserWindow` with WebGL, or OffscreenCanvas in a Web Worker; both documented and proven | Hidden webview window works but is at the mercy of each webview's throttling of hidden windows; OffscreenCanvas+WebGL support differs per WebKit version. Alternative: render thumbnails natively in Rust (wgpu), robust and fast but a second renderer to build and keep visually in sync with Three.js | **Electron** (lower risk); Tauri can be made excellent with more work |
| R3 Drag-out | Built in (`webContents.startDrag`) on all platforms | Third-party `tauri-plugin-drag` (CrabNebula). Works on Windows/macOS; Linux support is GTK-bound and limited | **Electron** |
| R4 File watching | chokidar / `@parcel/watcher` in Node; polling mode for NAS | `notify` crate, mature, with polling backend | Even |
| R5 Heavy CPU work | Node worker threads or `utilityProcess`; hashing via Node crypto is fast; zip via streaming libs | Rust: multi-threaded hashing/extraction with no worker plumbing, often several times faster, lower memory | **Tauri** |
| R6 SQLite + FTS5 | `better-sqlite3` is a native module: must be rebuilt per Electron version, breaks occasionally on upgrades, complicates CI. Node 22's built-in `node:sqlite` is an emerging alternative | `rusqlite` with bundled SQLite and FTS5 compiled in; zero runtime friction | **Tauri** |
| R7 E2E automation | Playwright's Electron support (`_electron`) is labelled experimental but is the de-facto standard, works on all three OSes, gives traces/screenshots/video, and agents know it well | WebDriver-based: official `tauri-driver` supports Windows and Linux only; macOS needs the WebdriverIO service with an embedded driver plugin or CrabNebula's paid driver. Tooling is younger and less known to agents. Workaround: test most UI in a browser against a mocked backend and keep a thin native smoke layer | **Electron**, and this matters a lot for an agent-driven project |
| R8 Shell integration | Complete | Complete via official plugins (dialog, fs, opener, notification, shell, trash via crate) | Even |
| R9 Auto-update | `update-electron-app` / electron-updater; mature; still needs OS code signing for public release | `tauri-plugin-updater`: mature, requires signing the update bundle with its own key pair plus OS code signing | Even |
| R10 Footprint | 100–200 MB install, 150–400 MB idle | 5–15 MB install, 40–80 MB idle (plus the shared system webview) | **Tauri**, clearly |
| R11 Productivity | TypeScript end to end; one toolchain; largest ecosystem; agents excel | TypeScript frontend + Rust backend; two toolchains, Rust compile times, capability/ACL config to maintain. Agents write Rust well, but iterate slower | **Electron** (moderately) |

### Reading the table

Tauri wins where it usually wins: footprint and raw backend performance. Electron wins
on the four requirements that are specific to *this* app and hard to work around: a
dependable WebGL renderer on every OS, offscreen thumbnail rendering, native drag-out,
and cross-platform E2E automation that agents can run. Those are not polish items; the
3D preview and thumbnails are the core of the product, and the verification strategy is
the core of how it is built.

The Linux point deserves emphasis. If Linux is a first-class target, Tauri means
accepting that some users will get a slow or glitchy 3D preview through no fault of the
app, with the only mitigation being driver-level environment flags. If Linux is out of
scope or best-effort, Tauri's weakest point mostly disappears, because WebView2 on
Windows is Chromium.

### Rust without Tauri?

A middle path exists: keep Electron as the shell but move the CPU-heavy engine
(scanning, hashing, extraction, SQLite) into a Rust sidecar or a napi-rs native module.
This recovers most of Tauri's R5/R6 advantage without giving up R1–R3/R7. It also adds
a second toolchain, so it should be adopted only when profiling shows Node is the
bottleneck, not up front.

## Recommendation

**Default: Electron**, rebuilt on a modern setup, because it de-risks the four
requirements that define this product and its development process. Concretely:

- Electron current stable with `electron-vite` or Electron Forge + Vite, strict context
  isolation, a typed IPC layer and `utilityProcess` workers for the engine.
- Keep the engine (scanner, watcher, index, sidecar I/O) as a shell-agnostic TypeScript
  package with no Electron imports, so a later move to a Rust sidecar or to Tauri
  remains possible.
- Playwright Electron for E2E, as in the spec.

**Choose Tauri instead if all of the following hold** (to be confirmed via Q1, Q2, Q20):

1. Windows is the primary platform and Linux is best-effort or out of scope.
2. Small install size and low memory are explicit product goals, not just nice to have.
3. Native drag-out can be an MVP stretch goal rather than a must.
4. You accept a WebdriverIO-based E2E setup (plus a browser-based test layer for the UI)
   instead of Playwright Electron.

If those hold, run a **two-day spike before committing**: a Tauri app that loads a
50 MB STL in Three.js on each target machine, renders 20 thumbnails in a hidden window,
drags a file into a slicer, and runs one WebdriverIO test in CI on Windows and macOS.
Measure, then decide.

## Consequences

- Scaffold epic in `docs/backlog.md` is filled in after this ADR is accepted.
- The UI framework decision (ADR-0002) is independent of this one: any option there
  works in both shells. React stays the default frontend framework unless ADR-0002 finds
  a strong reason to change; the mockups there are evaluated on design, not framework.
- Whatever the shell, the engine is written shell-agnostic (see above).

## Sources consulted (Oct 2026)

- Tauri docs: WebDriver testing and platform support; Linux graphics issues
  (`v2.tauri.app/develop/tests/webdriver/`, `v2.tauri.app/develop/debug/linux-graphics/`)
- WebdriverIO Tauri service platform support (`webdriver.io/docs/desktop-testing/tauri/platform-support`)
- CrabNebula `drag-rs` / `tauri-plugin-drag` docs (`docs.crabnebula.dev/plugins/drag-rs/`)
- Electron offscreen rendering tutorial (`electronjs.org/docs/latest/tutorial/offscreen-rendering`)
- Playwright `class-electron` API docs (`playwright.dev/docs/api/class-electron`)
- Release state: Electron 44.x stable / 45 scheduled 2026-10-20; Tauri 2.11.x; Wails v3 beta
