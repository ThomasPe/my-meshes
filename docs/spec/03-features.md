# 3. Functional Requirements

> Status: specification, technology-neutral. Decisions reference question numbers (Q#) in
> `docs/open-questions.md`. Priorities: **MVP** (phase 1) or **Later** (phase 2+).

## 3.1 Library & sync

| ID | Requirement | Priority |
|---|---|---|
| LIB-1 | Add and remove library roots via the native folder picker (typed paths as a secondary option). Invalid or unreadable paths are reported, not silently ignored. | MVP |
| LIB-2 | Recursive scan of each root finds model, image, document and attachment files, honoring the global ignore list. Scanning never writes to the library. | MVP |
| LIB-3 | Real-time file watching keeps the index in sync with external changes (files added, removed, renamed, sidecar edited). The UI reflects changes without a manual refresh. | MVP |
| LIB-4 | Fallback sync modes for volumes that cannot be watched (network shares): polled refresh with a configurable interval, and manual rescan. | MVP |
| LIB-5 | Offline protection: a missing root marks its content as offline; nothing is deleted from the index. A later rescan clears the offline state. | MVP |
| LIB-6 | Sync status per root: last sync time, syncing-in-progress indicator, and a detailed status log. | MVP |
| LIB-7 | A status bar shows background activity (indexing, hashing, thumbnail generation) with progress. | MVP |
| LIB-8 | Duplicate detection via content hashes; duplicates are flagged in the UI with a resolution flow. | Later |

## 3.2 Metadata

| ID | Requirement | Priority |
|---|---|---|
| META-1 | Read `project.yaml` per the schema in `02-domain-model.md`. Malformed files are surfaced as a project-level warning, not a crash. | MVP |
| META-2 | Edit title, creator, license, source URL, description and tags in the UI. Saving writes the sidecar in the background; the UI updates optimistically and rolls back on failure. | MVP |
| META-3 | Lazy creation: the sidecar is created on first edit only. | MVP |
| META-4 | Conflict detection: when the sidecar changed externally during an edit, block the save and offer reload. | MVP |
| META-5 | Rename a project in the app; the directory is renamed on disk. Name collisions are detected before anything is touched. | MVP |
| META-6 | Batch editing: apply tag, creator or collection changes to a multi-selection. | Later |
| META-7 | External enrichment: detect the source platform from archive contents, file names or URLs and offer to fetch title, creator, tags, description and images into the sidecar. Explicitly user-triggered. First Printables and Thingiverse (public APIs; Thingiverse with a user-supplied app key), then MakerWorld and Thangs limited to what a page publicly exposes (OpenGraph), never behind a login (Q8). | Later |

## 3.3 Browsing, search & organization

| ID | Requirement | Priority |
|---|---|---|
| NAV-1 | Sidebar with: library views (All, Recent imports, Favorites, Inbox), smart collections, manual collections, and the physical folder tree scoped to library roots. It belongs to the application shell and stays visible on the project page (picking anything in it returns to the library with that selection); only Welcome and Settings are full-width. A folder that is itself a project opens that project on click; containers filter the library. Expansion state is remembered across root collapses and restarts. | MVP |
| NAV-2 | Grid view with adjustable thumbnail size; stays smooth with 10,000+ items (virtualized). | MVP |
| NAV-3 | Detailed list view with sortable metadata columns (title, creator, tags, file count, size, date). | MVP |
| NAV-4 | Instant full-text search over title, description, tags and file names. | MVP |
| NAV-5 | Attribute filters derived from the data: tags, creator, license, file type, date ranges, material. | MVP |
| NAV-6 | Detail view for a project: metadata, file list with sizes and types, images, attachments, printing hints. | MVP |
| NAV-7 | Manual collections: create, rename, delete, add/remove projects, reorder. | MVP |
| NAV-8 | Smart collections: build a query from the available filters and save it. | MVP |
| NAV-9 | Project tabs: several projects open side by side; each tab keeps its own UI state. | Later |
| NAV-10 | Dashboard: inventory counts, recent activity, sync health. | Later |

## 3.4 Preview & visualization

| ID | Requirement | Priority |
|---|---|---|
| VIEW-1 | Interactive 3D preview for STL, OBJ and 3MF: orbit, pan, zoom, reset, standard views. Large files load progressively without freezing the UI. | MVP |
| VIEW-2 | 3MF: load geometry and read embedded thumbnail and metadata; slicer 3MFs get a badge. STEP, PLY and AMF are indexed as models with a "preview later" notice (Q11). | MVP |
| VIEW-3 | Thumbnail generation for every project in a background queue, stored per `02-domain-model.md`. The UI never blocks on it. | MVP |
| VIEW-4 | Custom thumbnails: "set current view as thumbnail" and "use image file as thumbnail". | Later |
| VIEW-5 | Built-in image viewer for project images; documents open in the OS default app. | MVP |
| VIEW-6 | Graceful degradation when GPU acceleration is unavailable: static placeholders instead of 3D views, with a visible notice. | MVP |
| VIEW-7 | Basic transforms (scale, rotate) for visual checks and mesh analysis for printability (non-manifold edges, holes, inverted normals). | Later |

## 3.5 Import & file operations

| ID | Requirement | Priority |
|---|---|---|
| IMP-1 | Drop one or more archives or folders onto the app to open the staging area. The app proposes projects; the user reviews, adjusts and confirms. | MVP |
| IMP-2 | Confirmed imports extract archives into new project directories inside a chosen root. The original archive is kept as an attachment by default; the dialog can instead move it to `_Originals`, leave it where it is, or send it to the Recycle Bin (Q7). The last choice is remembered. | MVP |
| IMP-3 | Loose files can be routed to the `_Inbox` folder of the chosen root; the inbox has its own view with a promote-to-project action, either one project from the selection or one project per file with editable names and a shared-prefix strip (Q6). | MVP |
| IMP-4 | Files that appear in a root via the OS (not through the app) are picked up by sync; archives found this way are attachments and are not extracted. | MVP |
| IMP-5 | Safe delete: deletions go to the OS trash after confirmation. | MVP |
| IMP-6 | Drag a model or project out of the app into another application (slicer, Blender, file manager) as native files. Low priority (Q20). | Later |
| IMP-7 | Organizational rules: default folder layouts (by creator, source platform or tag) applied by import and move flows. | Later |
| IMP-8 | Maintenance tools to reorganize, rename and clean up projects according to the rules, never creating nested projects. Done: projects move between folders of any root (context menu "Move to…" with a folder picker and optional new sub-folder, multi-selection, drag onto a tree row) with an Undo toast; destinations inside a project are refused. | Later (move: done) |

## 3.6 Application shell & productivity

| ID | Requirement | Priority |
|---|---|---|
| APP-1 | Runs on Windows (primary). macOS support is a stretch goal; Linux is out of scope for v1 (Q1). | MVP |
| APP-2 | Light, dark and system theme. | MVP |
| APP-3 | All user-facing text is localizable; English and German at launch, further languages after the Store release via community translations (Q13). | MVP |
| APP-4 | Settings: library roots, ignore patterns, thumbnail location, sync intervals, theme, language, notifications. | MVP |
| APP-5 | Keyboard shortcuts for core actions (search, delete, rename, navigate) with a central, configurable keymap. | Later |
| APP-6 | Undo/redo for disk operations (rename, move, tag) via inverse operations. | Later |
| APP-7 | Notifications for import errors, sync failures and completed background jobs. | MVP |
| APP-8 | Log viewer: browse, filter and export application logs for bug reports. | Later |
| APP-9 | Updates: private builds update themselves (manual check, optional beta channel); Store builds leave updating to the Store and hide the updater (Q2). | MVP |
| APP-10 | Native title bar (decided Q14): no frameless window in v1; Snap Layouts, Mica and accessibility come for free and Store review stays simple. Revisit after the MVP if wanted. | Decided |
| APP-12 | In-app feedback: "Send feedback" (Settings, error toasts) collects a bug report or idea with version, OS, WebView and library size and opens it as a prefilled GitHub issue form in the browser; a log excerpt with shortened user folders goes to the clipboard. The app never posts to GitHub itself (no token to ship) and the reporter owns the issue. | MVP |
| APP-11 | Store readiness: Windows build packaged as MSIX with a Partner-Center-matching identity; macOS build runs in the App Sandbox, so library roots are chosen through the native folder picker and access is persisted with security-scoped bookmarks. No feature may rely on unrestricted file-system access outside registered roots. | MVP (Win), Later (Mac) |
