# Product Backlog

This backlog is derived from the Technical Document `README.md`. It is organized by Epics and phased implementation steps.

## Phase 1: MVP (Minimum Viable Product)
*Goal: Local Library Manager with Read/Write/View Capabilities*

### Epic 1: Scaffold & Architecture
- [ ] **Initialize Repo**
  - Goal: Set up the official Electron Forge boilerplate with React and TypeScript.
  - AC:
    - Repo is initialized using `npm init electron-app -- --template=vite-typescript`.
    - `npm run start` launches the Electron window with React loaded.
    - `npm run make` creates a distributable executable.
- [ ] **UI & Styling**
  - Goal: Configure the visual foundation.
  - AC:
    - Tailwind CSS is configured and processing classes in Renderer.
    - Radix UI Themes provider is wrapping the app.
    - Titlebar is frameless; custom controls (Close/Min/Max) work via IPC.
- [ ] **State & Routing**
  - Goal: Set up global state and navigation.
  - AC:
    - React Router is functioning (can navigate between dummy pages).
    - TanStack Query is set up; a test query returns data.
- [ ] **Internationalization**
  - Goal: Prepare app for multi-language support.
  - AC:
    - `i18next` is initialized in Renderer.
    - Hardcoded strings are replaced with `t('key')` in the initial boilerplate.
- [ ] **Linting & Formatting**
  - Goal: Enforce code quality.
  - AC:
    - `eslint` disallows `any` type.
    - `prettier` formats code on save (or via script).
    - CI fails if code is not formatted/linted.
- [ ] **Testing Infrastructure**
  - Goal: Set up test runners.
  - AC:
    - `npm run test` runs Vitest for unit tests.
    - `npm run e2e` runs Playwright and passes a basic launch test.
- [ ] **Data & Security Architecture**
  - Goal: Secure and persistent foundation.
  - AC:
    - `better-sqlite3` is installed and works in the Main process (rebuilt for Electron).
    - `contextBridge` is used; no remote module enabled.
    - Content Security Policy (CSP) headers are present in dev and prod.
    - `electron-log` writes to a log file in the user data directory.
- [ ] **CI/CD Pipeline**
  - Goal: Automate checks and releases.
  - AC:
    - GitHub Action triggers on push; runs lint, test, and build.
    - **Multi-Platform Release:** Main builds publish binaries (Win/Mac/Linux) to GitHub Releases.
    - **Versioning:** `Nerdbank.GitVersioning` manages semantic versioning via git history.
- [ ] **Auto-Updater**
  - Goal: Integrated update flow.
  - AC:
    - App checks GitHub Releases for updates (electron-updater).
    - Notification/Prompt when update is available.

### Epic 2: Core File Management (The "Engine")
- [ ] **Library Root Setup**
  - Goal: Manage where the app looks for models.
  - AC:
    - User can add a folder path as a Library Root.
    - User can remove a Library Root.
    - Invalid paths are handled gracefully.
- [ ] **Recursive Scanner**
  - Goal: Index files on disk.
  - AC:
    - Scanner finds STL, OBJ, 3MF files in nested folders.
    - Scanner respects "Ignored Patterns" (e.g., .git, __MACOSX).
    - Scanner does NOT create `project.yaml` files (Lazy Enrichment).
- [ ] **Watcher Service**
  - Goal: Real-time sync.
  - AC:
    - `chokidar` detects new files moved into a Library Root.
    - `chokidar` detects deleted files and removes them from DB.
    - UI updates immediately when a file is added/removed externally.
- [ ] **Offline Handling**
  - Goal: Handle disconnected drives.
  - AC:
    - If a Library Root path is missing, items are marked "Offline" in UI.
    - "Offline" items are NOT deleted from the DB.
    - Rescanning when drive is back removes "Offline" status.
- [ ] **YAML Logic & Attributes**
  - Goal: Persistent metadata.
  - AC:
    - Parsing `project.yaml` works with Dublin Core fields (title, creator, license).
    - `project.yaml` is only created when user *edits* metadata.
    - Changing a tag in UI updates `project.yaml` in background.
- [ ] **Conflict Resolution** (Missing Feature)
  - Goal: Handle external edits to YAML.
  - AC:
    - App detects if `project.yaml` was modified externally while user is editing.
    - User is prompted to "Reload" UI to avoid overwriting external changes.

### Epic 3: Visualization & Interaction
- [ ] **Three.js Viewport**
  - Goal: Render 3D models.
  - AC:
    - STL/OBJ files render in a React component.
    - User can Rotate, Pan, and Zoom.
    - Large files stream in, do not freeze UI (Worker usage).
- [ ] **3MF Support**
  - Goal: Handle 3MF archives.
  - AC:
    - App extracts geometry from .3mf files.
    - Thumbnail is extracted from .3mf metadata if available.
- [ ] **Zip Handling**
  - Goal: Handle Archives *inside* projects.
  - AC:
    - ZIPs inside a Project folder are listed as "Attachments".
    - User cannot browse inside these ZIPs (treated as files).
- [ ] **Thumbnail Generator**
  - Goal: Visual previews.
  - AC:
    - Thumbnails are generated via offscreen rendering.
    - `preview.png` is saved next to the model file.
    - Generator Queue processes images in background without lagging UI.
- [ ] **Drag & Drop Export**
  - Goal: Workflow integration.
  - AC:
    - Dragging a thumbnail from App to Slicer (e.g., Cura) opens the file.
    - Uses `ipcRenderer.invoke('ondragstart')`.

### Epic 4: Library UI & Organization
- [ ] **Grid View**
  - Goal: Efficient browsing.
  - AC:
    - `react-window` renders 10,000+ items smoothly.
    - Thumbnail size is adjustable (Slider).
- [ ] **Folder Tree**
  - Goal: Navigation.
  - AC:
    - Sidebar mirrors physical disk structure.
    - Clicking a folder filters Grid View to that scope.
- [ ] **Smart Collections** (Missing Feature)
  - Goal: Saved searches.
  - AC:
    - User can create a "Smart Collection" (e.g., "Tag = Gridfinity").
    - Smart Collections are saved in `collections.json` (not SQLite).
- [ ] **Detail View & Search**
  - Goal: Information access.
  - AC:
    - Sidebar shows metadata, file list, and file size.
    - Search bar filters results instantly using FTS5 (SQLite).

### Epic 5: Ingestion & Import
- [ ] **Import Workflow**
  - Goal: Bringing new files in.
  - AC:
    - Drag & Drop ZIP to App Window -> Opens Staging Area.
    - Staging Area allows reviewing contents before Import.
    - Import button unzips contents to a new Project Folder.
- [ ] **Passive Sync (OS Drop)**
  - Goal: Drag to Explorer.
  - AC:
    - Files dropped into Explorer (not App) are detected by Watcher.
    - If ZIP, treated as Attachment (not auto-unzipped).
- [ ] **Safe Delete**
  - Goal: Data safety.
  - AC:
    - Deleting a file moves it to OS Trash/Recycle Bin.
    - Confirm dialog is shown before delete.

---

## Phase 2: Enhanced Features (Quality of Life)

### Epic 6: Advanced Metadata & Enrichment
- [ ] **External Scraper**
  - Goal: Auto-fill metadata.
  - AC:
    - Regex detects Thingiverse/Printables URLs in text files/source.
    - Scraper fetches Title, Author, Tags from URL.
- [ ] **Duplicate Detection**
  - Goal: Library hygiene.
  - AC:
    - SHA-256 hash calculated for every file.
    - Duplicates flagged in UI.
- [ ] **Batch Editing**
  - Goal: Bulk actions.
  - AC:
    - User can select multiple projects.
    - "Add Tag" applies to all selected.

### Epic 7: User Experience Polish
- [ ] **Keybinding Manager**
  - Goal: Power user controls.
  - AC:
    - Standard shortcuts (Del, F2, Ctrl+F) work.
    - Shortcuts are configurable in Settings.
- [ ] **Undo/Redo System**
  - Goal: Error recovery.
  - AC:
    - Rename/Tag operations pushed to Undo Stack.
    - Ctrl+Z reverts the file system/DB change.
- [ ] **Log Viewer & Hardware Check**
  - Goal: Debugging.
  - AC:
    - UI for viewing main/renderer logs.
    - Startup check for WebGL support; warnings if missing.

### Epic 8: Customization & Safety
- [ ] **Custom Thumbnails**
  - Goal: User control over visuals.
  - AC:
    - "Set Current View" updates `preview.png`.
    - User can upload custom image.
- [ ] **Settings Module**
  - Goal: Configuration.
  - AC:
    - Ignore Patterns are editable.
    - Theme selector (System/Dark/Light).
