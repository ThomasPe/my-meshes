# ADR-0001: Application shell and tech stack

- Status: **accepted** 2026-10-17: **Tauri 2 with a Rust engine** (Q21 answered: Rust is welcome). Electron stays the documented fallback if the spike in the backlog fails.
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


---

## Revision 2026-10-17: Windows first, Store distribution, drag-out deprioritized

Answers received: Windows is the primary platform; private builds first, then a
Microsoft Store release; a Mac App Store release is a stretch goal; Linux is out of
scope; drag-out is a low-priority nice-to-have.

### What changes in the Electron vs. Tauri table

| Req | Before | Now |
|---|---|---|
| R1 WebGL everywhere | Electron, strongly | **Even.** WebView2 *is* Chromium, so Tauri's WebGL story on the primary platform equals Electron's. WKWebView on macOS is adequate. The WebKitGTK problem is gone with Linux. |
| R2 Offscreen thumbnails | Electron | **Nearly even.** Hidden WebView2 windows and OffscreenCanvas in a worker both work in Chromium. macOS stays a mild Tauri risk (WKWebView throttling of hidden windows). |
| R3 Drag-out | Electron | **Irrelevant** for the MVP; `tauri-plugin-drag` covers Windows and macOS if it is ever wanted. |
| R7 E2E automation | Electron, strongly | **Electron, moderately.** `tauri-driver` works on Windows via Edge WebDriver, so the primary platform is covered. macOS needs the WebdriverIO embedded-driver route later. Playwright against the real app remains the smoother agent loop. |
| New: Store packaging | n/a | **Electron, slightly.** Electron Forge ships `@electron-forge/maker-msix` (experimental, Forge ≥ 7.10) and the older `maker-appx`; electron-builder has an MSIX target (beta). Tauri has no native MSIX output; Store shippers wrap the build with `MakeAppx.exe` and a hand-written `AppxManifest.xml`, which is a small script but one you own. Mac App Store: both have documented sandbox/entitlement paths; Electron's MAS build is older and better trodden. |
| New: runtime update burden | n/a | **Tauri.** A Store app must keep its embedded engine patched. Electron means shipping a new Chromium every ~8 weeks forever; Tauri's WebView2 is patched by Windows itself. |

Net effect: the four requirements that made Electron the clear default are now neutral
or irrelevant. What remains is a trade between **agent/test ergonomics and a
one-language stack (Electron)** and **footprint, backend speed, no native-module
churn, and no runtime update treadmill (Tauri)**.

### Other stacks examined for a Windows-first, Store-bound, 3D-centric app

| Stack | Verdict | Why |
|---|---|---|
| **WinUI 3 (Windows App SDK, C#)** | Reject unless macOS is dropped | Best possible Store integration and native Fluent (matches mockup B for free). 3D needs a custom DirectX/Win2D path or a WebView2 island for Three.js. Windows only, so the macOS stretch goal dies. |
| **Avalonia (C#, cross-platform XAML)** | Strongest non-web candidate; reject for this project | Windows + macOS from one codebase, MSIX and Mac App Store feasible, .NET backend is excellent for the engine (FileSystemWatcher, SQLite FTS5, threads). Costs: no Three.js, so a custom OpenGL viewer (OpenTK on `OpenGlControlBase`) or a commercial 3D control; 3MF via lib3mf bindings; offscreen thumbnails via GL framebuffers (robust, but all hand-built). Smaller UI ecosystem than the web; agents are slower in XAML. Choose it only if you would rather write C# than TypeScript and accept building the 3D layer yourself. |
| **Uno Platform** | Reject | WinUI API on macOS via Skia; same 3D gap as Avalonia with more moving parts. |
| **.NET MAUI / Blazor Hybrid** | Reject | Web UI in WebView2 with a .NET backend is attractive on paper, but MAUI desktop quality and macOS-via-Catalyst are weak, and the sandbox story is poorly documented. |
| **Photino.NET ("Tauri with C#")** | Reject | Right idea, tiny community: no updater, no plugin ecosystem, no Store tooling. You would rebuild what Tauri already has. |
| **Flutter desktop** | Reject | Good Windows/macOS shells and an `msix` package, but 3D is immature (no maintained Three.js equivalent). Wrong fit for an app whose core is a mesh viewer. |
| **Qt 6 / Qt Quick 3D (C++ or PySide6)** | Technically excellent, reject on velocity | Built-in mesh loading, offscreen rendering and a mature 3D scene graph; Store distribution possible. But C++/QML or Python packaging, LGPL discipline, and far slower agent iteration than web stacks. None of the four mockups maps onto it. |
| **Compose Multiplatform (Kotlin)** | Reject | JVM footprint, no 3D story, Store packaging via jpackage only. |
| **Wails v3 (Go)** | Wait | Still beta; no MSIX; Go backend is pleasant but the ecosystem around updates and Store is thin. Revisit if Tauri disappoints and Rust is unwanted. |
| **PWA + File System Access API** | Reject (fails spec) | Zero-install and Store-publishable via PWABuilder, Chromium's directory handles persist across sessions. But no file watching (polling only), no OS trash, no background work when closed. Breaks LIB-3 and IMP-5. |

### Revised recommendation

**Tauri 2 is now the recommended default**, conditional on Q21 (Rust is acceptable in
the stack). The reasons the previous revision gave for Electron no longer apply to a
Windows-first, Store-distributed app, and Tauri's advantages matter more for a Store
app: a 10–15 MB package, a system webview that Windows keeps patched, a Rust engine
that makes hashing, extraction and SQLite FTS5 trivial to ship, and a capability model
that maps cleanly onto the Mac App Store sandbox later.

Mitigations for Tauri's remaining weak points, to be built into the scaffold:

1. **Testing:** keep the UI testable in a plain browser with a mocked backend API
   (Playwright, fast, what agents know), and add a thin layer of `tauri-driver`
   WebDriver tests against the real Windows app for smoke and disk side effects.
2. **MSIX:** a scripted `MakeAppx` step in CI from day one, so the Store path is
   exercised long before the first submission.
3. **Thumbnails:** OffscreenCanvas in a Web Worker inside the main webview first; a
   hidden window only as fallback; a Rust renderer only if measurements demand it.
4. **Spike before committing (2 days, on your Windows machine):** 50 MB STL in Three.js
   inside WebView2, 20 thumbnails via OffscreenCanvas, `tauri-driver` test in GitHub
   Actions on `windows-latest`, MSIX built and side-loaded. If any of these fails
   outright, fall back to Electron without changing anything else in the plan.

**Electron remains the safe alternative** if Rust is unwelcome: Forge + Vite,
`maker-msix`, Playwright Electron, and a TypeScript engine package, exactly as in the
first revision. It is a known quantity with no open risk for this profile; its costs are
size, memory and the Chromium update cadence.

In both cases the engine (scanner, watcher, index, sidecar I/O) is written as a
shell-agnostic package, and the UI framework decision in ADR-0002 is unaffected.

### Additional sources for this revision

- Electron Forge makers: `electronforge.io/config/makers/msix`, `electronforge.io/config/makers/appx`
- electron-builder MSIX target: `electron.build/docs/msix/`
- Tauri App Store distribution guide: `v2.tauri.app/distribute/app-store/`
- Microsoft MSIX Packaging Tool overview: `learn.microsoft.com/windows/msix/mpt-overview`
- Avalonia OpenGL controls: `docs.avaloniaui.net/api/avalonia/opengl/controls`

## Decision (2026-10-17)

**Tauri 2, Rust backend, TypeScript frontend.** Concretely:

- **Shell:** Tauri 2.x (current 2.11 line), Windows first; macOS build added when the
  stretch goal is picked up.
- **Engine:** a shell-agnostic Rust library crate (`crates/engine`) holding scanner,
  watcher, index, sidecar I/O, hashing and archive handling. `src-tauri` is a thin
  layer of commands and events over it, so the engine can be unit-tested with
  `cargo test` and reused outside Tauri.
- **Frontend:** Vite + TypeScript + Three.js; component framework per ADR-0002 (React
  unless that decision says otherwise). Frontend talks to the engine only through a
  typed command/event API with explicit Tauri capabilities.
- **Testing:** `cargo test` for the engine; Vitest for frontend logic; Playwright
  against the UI in a browser with a mocked backend API for fast agent loops;
  WebdriverIO + `tauri-driver` against the real Windows app for smoke tests and
  disk-side-effect assertions.
- **Distribution:** NSIS installer plus `tauri-plugin-updater` for private builds;
  MSIX via a scripted `MakeAppx` step for the Store; updater disabled in Store builds.
- **First task:** the two-day spike described above, as backlog item 0.4. If it fails
  outright, switch to Electron and keep everything else in this document.

## Spike results (2026-10-17)

Code: `spike/`. CI: `.github/workflows/spike-windows.yml`, first run
<https://github.com/ThomasPe/my-meshes/actions/runs/39067620670> (all steps green).

| Check | Windows CI (`windows-latest`, WebView2 154, **no GPU**: Microsoft Basic Render Driver) | Linux dev container (WebKitGTK 2.52, software GL) | Verdict |
|---|---|---|---|
| (a) 50 MB STL, 1,002,528 triangles | Generated by Rust in <1 s; raw IPC read **1.10 s**; worker parse **140 ms**; GPU upload **185 ms**; JS heap 149 MB; orbit 2 fps (software rasterizer) | IPC read 1.28 s; parse 217 ms; upload 1.45 s; 3 fps (software) | **Pass** functionally. FPS must be measured on real hardware (0.4b). |
| (b) 20 thumbnails off the UI thread | **Worker + OffscreenCanvas works in WebView2**; 20/20 PNGs on disk (3.7 MB); render 167 ms, encode 684 ms each on the software rasterizer | No WebGL in workers on WebKitGTK; the **main-thread fallback** rendered 20/20 | **Pass.** Fallback path exists for webviews without worker WebGL. |
| (c) WebDriver E2E in CI | `@wdio/tauri-service`, embedded provider (`tauri-plugin-wdio-webdriver`), 2 specs passing in 54 s, screenshots + results JSON as artifacts | Same, under Xvfb, 2 passing | **Pass.** No msedgedriver management needed. |
| (d) MSIX | `MakeAppx` pack + self-signed `signtool`; `Add-AppxPackage` installs, packaged app launches, removed again | n/a | **Pass.** Store submission additionally needs the Partner Center identity and no self-signing. |

Observations that feed the scaffold:

- Raw binary IPC in both directions (`tauri::ipc::Response` for reads, `Request` body for
  writes) is the right transport for geometry and images; 50 MB in about a second with
  no JSON or base64.
- The first CI numbers for "UI stays responsive" and "IPC write per thumbnail" were
  polluted by the main viewer redrawing a 1M-triangle mesh on a software rasterizer in
  the same thread; the spike now pauses the viewer while thumbnails render. The real app
  should throttle its viewport (render on demand) for the same reason.
- `tauri build --features e2e` compiles the WebDriver plugins in; the plain release build
  does not register them. For the real app, keep them out of release binaries via an
  optional dependency plus a separate e2e capability file.
- Cold Windows CI build: 11 min for the e2e build, 3 min for the second (cached) build.
  `Swatinem/rust-cache` brings later runs down considerably.

Decision stands: **Tauri 2**. Open item 0.4b (real GPU) is a measurement, not a gate,
unless orbiting a 1M-triangle mesh falls below 30 fps on your machine.
