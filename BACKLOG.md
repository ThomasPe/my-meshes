# Product Backlog

This backlog is derived from the Technical Document `README.md`. It is organized by Epics and phased implementation steps.

## Phase 1: MVP (Minimum Viable Product)
*Goal: Local Library Manager with Read/Write/View Capabilities*

### Epic 1: Scaffold & Architecture
- [ ] **Initialize Repo:** Set up Electron + Vite + React + TypeScript boilerplate.
- [ ] **IPC Bridge:** Implement secure `contextBridge` for Main/Renderer communication.
- [ ] **SQLite Integration:** Set up `better-sqlite3` instancing and basic schema (Projects, Files, Tags).
- [ ] **Logging System:** Implement specific logging for Main and Renderer processes (e.g., `electron-log`).
- [ ] **Window Management:** Implement `electron-titlebar` for custom frameless UI.

### Epic 2: Core File Management (The "Engine")
- [ ] **Library Root Setup:** Ability to add/remove local directories as "Library Roots".
- [ ] **Recursive Scanner:** Node.js crawler to detect folders and supported files (STL/OBJ/3MF) with "Ignored Patterns" support.
- [ ] **Watcher Service:** Implementation of `chokidar` to detect file additions/deletions in real-time.
- [ ] **Offline Handling:** Logic to mark items as "Offline" (not deleted) when a drive unmounts.
- [ ] **YAML Logic:** 
    - Function to read `project.yaml`.
    - **Lazy Enrichment:** Generate `project.yaml` only on user edit (Tag/Rename), not during initial scan.
    - Bi-directional sync (File changed -> DB updated).

### Epic 3: Visualization & Interaction
- [ ] **Three.js Viewport:** Basic React component to render an STL file.
- [ ] **3MF Support:** Logic to parse 3MF structure (technically zip-based) to extract geometry and thumbnail.
- [ ] **Zip Handling:** Treat `.zip` files found in existing folders as generic "Project Attachments" (non-browsable).
- [ ] **Thumbnail Generator:** 
    - Implementation of Offscreen Rendering window.
    - Queue system to process images in background.
    - Save as `preview.png` sidecar.
- [ ] **Drag & Drop Export:** Implement `ipcRenderer.invoke('ondragstart', filePath)` for dragging models to Slicers.

### Epic 4: Library UI & Organization
- [ ] **Grid View:** Virtualized Grid (using `react-window`) with adjustable thumbnail size.
- [ ] **Folder Tree:** Sidebar component mirroring the physical disk structure of Library Roots.
- [ ] **Detail View:** Side panel showing metadata (`project.yaml` content) and file list.
- [ ] **Optimistic UI:** Immediate UI reflection for Metadata/Tag changes; rollback on disk-write failure.
- [ ] **Search:** Implementation of FTS5 SQLite search for fast filtering.

### Epic 5: Ingestion & Import
- [ ] **Staging Area UI:** Temporary view for reviewing new folders found or files dropped.
- [ ] **Import Workflow:** 
    - Move files from Staging -> Library folder structure.
    - **Auto-Unzip:** Automatically extract imported `.zip` files into new Project folders.
- [ ] **Safe Delete:** Implement `shell.moveItemToTrash`.

---

## Phase 2: Enhanced Features (Quality of Life)
*Goal: Automation, Safety, and Power User Features*

### Epic 6: Advanced Metadata & Enrichment
- [ ] **External Scraper:** Logic to detect source URL (Thingiverse/Printables) from ZIP import.
- [ ] **Metadata Fetcher:** Fetch tags, description, and images from external source API/HTML.
- [ ] **Duplicate Detection:** SHA-256 Hasher worker to flag duplicates during scan.
- [ ] **Batch Editing:** UI for multi-selecting projects and applying bulk tag/property changes.

### Epic 7: User Experience Polish
- [ ] **Project Tabs:** State management to keep multiple project views open in tabs.
- [ ] **Keyboard Shortcuts:** Global keybinding manager (Search, Delete, Rename).
- [ ] **Undo/Redo System:** Transaction stack for critical file operations (Rename, Move).
- [ ] **Hardware Check:** WebGL capability detection on startup.

### Epic 8: Customization & Safety
- [ ] **Thumbnail Customization:** "Set Current View as Thumbnail" context menu action.
- [ ] **Collections Persistence:** `collections.json` reader/writer for Virtual Collections.
- [ ] **Settings Module:** UI for Ignore Patterns, Thumbnail location (Sidecar vs AppData), and Theme.
- [ ] **Auto-Updater:** Configure `electron-updater` for GH Releases.