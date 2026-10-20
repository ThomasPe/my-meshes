# Meshkeep

A local-first desktop library manager for 3D printing models (STL, OBJ, 3MF): browse,
preview, tag and organize the models on your own disks, Lightroom-style.

## Status: Phase 1 complete, Store submission pending

Built on **Tauri 2 + Rust** with a **React / Tailwind 4 / shadcn-style** frontend (decisions
in `docs/decisions/`). What works today:

- library folders on local disks, network shares and external drives; watch, poll or manual
  sync; offline roots keep their projects
- read-only scanning, `project.yaml` sidecars created lazily and written atomically with
  conflict detection; rename and safe delete to the Recycle Bin
- virtualized grid and list, full-text search, filters by tag, folder, creator, license,
  material and file type; favorites, recent additions, collections and smart collections
- rendered thumbnails (STL, OBJ, 3MF) in a background queue, slicer 3MF previews, a 3D
  viewer with progressive loading and 3MF colours (materials, Bambu/Orca and PrusaSlicer
  painting), an image viewer
- import with a staging step (zip, 7z, folders, loose files), inbox per root, drag and drop
- settings for ignore patterns, bundle folders, preview location, notifications, theme and
  language (en/de); self-updater in private builds, Microsoft Store build without it
- feedback from inside the app: bug reports and ideas open as prefilled GitHub issues with
  version and system info, nothing is sent in the background

Phase 2 (duplicates, keymap, undo, custom thumbnails, ...) is listed in `docs/backlog.md`.

```bash
npm ci && npm run tauri:dev        # needs Rust + (Windows) MSVC Build Tools, see AGENTS.md
npm run dev                        # frontend only, browser mode with mock data
```

Working agreements for humans and agents: [`AGENTS.md`](AGENTS.md).

- The previous Electron/React implementation is preserved on the
  [`archive/electron-v1`](https://github.com/ThomasPe/my-meshes/tree/archive/electron-v1)
  branch.
- The specification lives in [`docs/`](docs/README.md). Start with
  [`docs/spec/01-vision.md`](docs/spec/01-vision.md).
- Open points that need answers before implementation: [`docs/open-questions.md`](docs/open-questions.md).
- The application shell is decided: **Tauri 2 with a Rust engine**, see
  [`docs/decisions/0001-tech-stack.md`](docs/decisions/0001-tech-stack.md). The UI
  framework and visual direction are still open in
  [`docs/decisions/0002-ui-framework.md`](docs/decisions/0002-ui-framework.md) with
  interactive HTML mockups in [`docs/mockups/`](docs/mockups/README.md).

## License

Meshkeep is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE): read it, build it, use it and change it
for any noncommercial purpose. Selling the app or offering it commercially is reserved to
the copyright holder; the Microsoft Store release is distributed under its own terms.
Keep the [`NOTICE`](NOTICE) file with every copy. Contributions are welcome under the
rights grant in [`CONTRIBUTING.md`](CONTRIBUTING.md).
"Meshkeep" is the name of this project and is not covered by the license.
