# Tauri 2 spike

De-risking spike for ADR-0001 (`docs/decisions/0001-tech-stack.md`). It answers four
questions before the real scaffold is built:

| # | Question | How the spike answers it |
|---|---|---|
| a | Does a 50 MB STL (1,000,000 triangles) load and orbit smoothly in Three.js inside **WebView2**? | `generate_test_stl` (Rust) writes the file, `read_file` streams it as a raw IPC response, a Web Worker parses it, Three.js renders it; FPS is sampled while auto-orbiting. |
| b | Can **thumbnails render off the UI thread**? | A worker with `OffscreenCanvas` + Three.js renders 20 views, encodes PNGs, the main thread hands the bytes to Rust (`write_thumbnail`, raw IPC body) which writes them atomically. The main thread's worst frame gap is measured meanwhile. |
| c | Can the app be **driven by WebDriver in CI**? | `test/specs/spike.spec.ts` runs with `@wdio/tauri-service` (embedded WebDriver provider) on `windows-latest` and asserts UI state and disk state. |
| d | Can we **ship an MSIX** for the Store? | `msix/build-msix.ps1` packs the release binary with `MakeAppx`, signs it with a self-signed cert; `msix/sideload-test.ps1` installs, launches and removes it. |

Plus one bonus measurement for the engine: `scan_and_hash` SHA-256-hashes a folder on
all cores (rayon) and reports MB/s.

## Running

Prerequisites: Node 22 and the Rust toolchain. On Windows:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
# open a new terminal, then: cargo --version
```

(`cargo: program not found` from `npm run tauri dev` means Rust is missing or the terminal
was opened before the install.) On Linux, for development only:
`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`.

```bash
cd spike
npm ci
npm run tauri dev                       # the app, hot reload
npm run tauri build -- --no-bundle      # release binary in src-tauri/target/release
npm run tauri build -- --no-bundle --features e2e   # same + WebDriver plugins
npm run test:e2e                        # WebdriverIO against the e2e build (Windows/macOS/Linux)
npm run test:browser                    # headless Chromium, Rust mocked, workers + WebGL real
pwsh msix/build-msix.ps1                # Windows: MSIX + self-signed cert
pwsh msix/sideload-test.ps1             # Windows: install, launch, remove
```

Click **Run full spike** in the app (or let the E2E test do it). The results JSON on the
page is what the CI job uploads as `logs/spike-results.json`.

## Pass criteria (from the backlog, item 0.4)

- STL with ≥ 1,000,000 triangles loads; orbiting stays ≥ 30 fps on the target machine.
- 20 thumbnails land on disk; the UI thread never stalls > 200 ms while they render.
- The WebDriver test passes on `windows-latest`.
- The MSIX installs via `Add-AppxPackage` and the packaged app starts.

Any hard failure means fall back to Electron per ADR-0001. Soft misses (slow FPS on a CI
runner without a GPU) are expected on GitHub-hosted runners and must be re-measured on
your Windows machine; the `verdict` block in the results separates the two.

## Results so far

First CI run on `windows-latest` (no GPU): all four checks passed. Numbers and the
Linux comparison are in `docs/decisions/0001-tech-stack.md`, section "Spike results".
Run it on a machine with a GPU for FPS and thumbnail timings that mean something:

```powershell
cd spike; npm ci; npm run tauri dev     # click "Run full spike", read the Results JSON
```

or install the MSIX from the CI artifact (`spike-<run>.zip`): import `spike-dev.cer`
into *Trusted People* (local machine), then double-click the `.msix`.

## Layout

```
spike/
  index.html, src/            Vite + TypeScript + Three.js frontend (no UI framework on purpose)
  src/workers/                stl-worker (parse), thumb-worker (OffscreenCanvas render + PNG)
  src/backend.ts              Tauri commands, or an in-memory mock in a plain browser
  src-tauri/                  Rust: commands, capabilities, icons, tauri.conf.json
  test/specs/spike.spec.ts    WebdriverIO E2E;  wdio.conf.ts
  test/browser-smoke.mjs      Playwright browser-mode smoke
  msix/                       AppxManifest.xml, Assets, build-msix.ps1, sideload-test.ps1
```

The WebdriverIO plugins are compiled in but only registered with `--features e2e`; the
release MSIX is built without the feature. The real app will go further and keep the
plugins out of release binaries entirely.
