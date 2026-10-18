# Meshkeep

A local-first desktop library manager for 3D printing models (STL, OBJ, 3MF): browse,
preview, tag and organize the models on your own disks, Lightroom-style.

## Status: rebuild in progress (scaffold + walking skeleton)

The project is being rebuilt from scratch on **Tauri 2 + Rust** with a **React / Tailwind 4 /
shadcn-style** frontend (decisions in `docs/decisions/`). What works today:

- add library folders, scan them (read-only), browse projects in a virtualized grid or list
- full-text search, tag and folder filters, inspector with details
- edit metadata and tags; `project.yaml` is created lazily and written atomically with
  conflict detection
- STL preview (Three.js, parsed in a Web Worker), files table, settings (roots, sync mode,
  ignore patterns, theme, language en/de)
- offline roots keep their projects; file watching rescans automatically

Not yet: rendered thumbnails, import/staging, collections, 3MF/OBJ preview (see
`docs/backlog.md`).

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
