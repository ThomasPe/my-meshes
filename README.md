# My Meshes

A local-first desktop library manager for 3D printing models (STL, OBJ, 3MF): browse,
preview, tag and organize the models on your own disks, Lightroom-style.

## Status: rebuild in progress

The project is being rebuilt from scratch. This branch currently holds **only the
specification and decision documents**; there is no application code yet.

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
