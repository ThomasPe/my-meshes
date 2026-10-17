# Click dummy (direction D, Gallery)

`index.html` is a self-contained, multi-screen click dummy of the MVP in the chosen
visual direction. Open it in any browser (double-click works, no server needed). Plain
HTML, CSS and vanilla JavaScript with hash routing; no framework, no build.

| Route | Screen |
|---|---|
| `#welcome` | First-run screen |
| `#library` | Library: sidebar (views, smart collections, collections, folder tree), grid and list view, search, tag filters, sort, zoom, inspector, context menu, multi-select |
| `#project` | Project detail: viewer with orbit (CSS 3D stand-in), metadata form, printing hints, files, images, attachments |
| `#import` | Staging area for dropped archives with source detection, target folder, archive handling; inbox with promotion |
| `#collections` | Manual collections and the smart collection editor with live preview |
| `#activity` | Per-root sync state, background jobs, filterable log |
| `#settings` | Library roots and sync modes, ignore patterns, thumbnail location, appearance, updates, privacy, about |

Interactions that work: selection (click, Ctrl, Shift), double-click to open,
right-click menu, `Del` (trash dialog), `F2` (rename), `Ctrl+K` (search), tag add and
remove with optimistic sidecar toasts, theme toggle (light, dark, system), import run,
smart collection rules, settings toggles. All data is in-memory sample data.

The `:root` token block at the top of the file is the seed for the real design system
(see `docs/decisions/0002-ui-framework.md`). `screenshots/` holds reference renders.
