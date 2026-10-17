# 3D Model Manager
*Initial Technical Document*

## 1. Overview

**Purpose:**  
This application is designed to help users organize, preview, and prepare local 3D model files (e.g., STL, OBJ) for 3D printing. By leveraging Electron, the app can run on major platforms (Windows, macOS, Linux) while offering a seamless, native desktop experience.

**Goals:**
- Provide an intuitive interface for browsing and managing 3D model files stored on a hard drive. Similar user experience to 3D model repositories like Thingiverse or MyMiniFactory, but focused on local files.
- Enable users to tag, categorize, and search their 3D model collections efficiently.
- Easily add new models by drag-and-drop or folder scanning.
---

**Similar applications & inspiration**:
- **Photoshop Lightroom**: For photo organization and management.
- **Plex**: For media file organization and streaming.
- **3D Model Repositories**: Thingiverse, MyMiniFactory, Makerworld, Thangs

**UI mockups:**
- [`mockup.png`](mockup.png) — Lightroom-style direction (folder tree, dense grid, project tabs).
- [`mockups/`](mockups/README.md) — five mockups exploring the "private MakerWorld / Thingiverse / Thangs" direction (home, browse with facets, model page, designers, collection boards).

## 2. Technical Decisions

### 2.1 Technology Stack

| Layer              | Technology(s)                                        | Rationale                                                                                  |
|--------------------|------------------------------------------------------|--------------------------------------------------------------------------------------------|
| **Application Base** | Electron, Electron Forge, Typescript                                         | Cross-platform desktop application packaging and native integration                        |
| **Updates**          | update-electron-app, @electron-forge/publisher-github                        | Over-the-air auto-updates via update.electronjs.org with Forge-native publishing           |
| **Frontend UI**    | React, [shadcn/ui](https://ui.shadcn.com/) (Radix primitives), Tailwind CSS | Component-based architecture with accessible primitives, pre-built Tailwind-styled components |
| **Routing & State** | React Router, TanStack Query | Manage navigation and efficient server-state caching                         |
| **Database (Cache)** | SQLite (`better-sqlite3`)           | High-performance read-only cache with Full-Text Search (FTS5)              |
| **File System & IPC**| Node.js `fs`, Chokidar, Electron IPC | Secure, isolated file access via Context Bridge; real-time watching        |
| **Data & Rendering** | Three.js, JSZip, js-yaml             | 3D viewport access; Handling ZIP/3MF Archives; Parsing YAML metadata       |
| **Bundling & Building** | Vite                                   | Effective asset bundling with optimized builds for production                                |
| **Testing**        | Vitest (unit tests), Playwright (e2e tests) | Ensures components work individually and the app functions as a whole                          |
| **Code Quality**   | ESLint, Prettier                                     | Maintain clear, consistent coding standards throughout the project                           |
| **Internationalization** | i18next, react-i18next                        | Support for multiple languages and localization                                            |

### 2.2 Data Standard

To ensure long-term compatibility and human readability, the project uses a standardized YAML sidecar format (`project.yaml`) inspired by **3MF** and **Dublin Core** standards.

**Proposed Structure (`project.yaml`):**
```yaml
metadata:
  title: "Gridfinity Storage Bin"       # dc:title
  creator: "Zach Freedman"              # dc:creator / 3MF 'designer'
  license: "CC-BY-NC-SA-4.0"            # dc:rights / 3MF 'licenseTerms'
  source_url: "https://thangs.com/..."  # dc:identifier
  tags:
    - gridfinity
    - organizer
  
printing:                               # Schema.org/3DModel technical properties
  recommended_material: "PLA"
  supports_required: false
  
files:
  - path: "Bin_1x1.stl"
    description: "Standard single bin"
```

### 2.3 Performance & Architecture strategy

- **Worker Threads (Main Process):** CPU-intensive file-system tasks (hashing, archive extraction, bulk YAML parsing) execute in Node.js Worker Threads.
- **Web Workers (Renderer):** Geometry parsing (STL/OBJ/3MF) for 3D preview runs in Web Workers to keep the UI thread free.
- **Offscreen Rendering:** Thumbnail generation utilizes Electron's hidden BrowserWindow (offscreen rendering) to access WebGL contexts correctly, avoiding "headless" limitations.
- **IPC Pattern:** Strict `Context Isolation` usage. The frontend requests actions (e.g. `scanProject`) via a secure API bridge; the Main process handles the disk I/O.
- **Virtual Lists:** The UI will use list virtualization (e.g. `react-window`) to performantly render libraries with thousands of items.

### 2.4 Privacy & Security

- **Offline First:** The application operates entirely locally. No telemetry, metadata, or file content is uploaded to the cloud.
- **Local Processing:** All analysis, thumbnail generation, and indexing occur on the user's machine.

### 2.5 Agent-Driven Verification Strategy

- **Agent-Owned Acceptance:** Each backlog step implemented by an agent must be verified end to end before it is considered complete.
- **Electron Control:** End-to-end verification must use Playwright's Electron support to launch and control the desktop app, not browser-only automation.
- **Deterministic Test Mode:** The app must provide a dedicated test mode with isolated user data, cache, logs, and seeded fixture paths so agent runs are reproducible.
- **Stable Selectors:** Critical UI flows must expose stable test selectors for automation.
- **Outcome Verification:** Agent verification must assert both visible UI behavior and persisted side effects on disk or in the cache when relevant.
- **Failure Evidence:** Test failures must produce usable diagnostics such as screenshots, traces, and application logs.

## 3. Core Features

### 3.1 File Management & Storage Strategy

- **Local Source of Truth:**
  - All metadata and assets (images, SCAD, PDFs) must be stored on disk alongside the model files.
  - A text-based description file (e.g. JSON/YAML) serves as the source of truth for each "Project". 
  - A database (e.g., SQLite) serves as a **read-only cache** for performance/indexing.
  - **File Sync:** A robust file watcher service monitors file system events.
    - **Optimistic UI:** The interface updates immediately upon user interaction (e.g., tagging), writing to disk in the background to ensure responsiveness.
    - **Network/NAS Support:** Includes fallback modes for non-watchable volumes (e.g., Polled Refresh, Manual Rescan).
    - **Offline Protection:** Detects if a volume/drive is disconnected (missing root path); marks files as "Offline" instead of deleting them from the database to prevent data loss.
    - **Sync Status:** UI indicators for "Last Sync Time," "Syncing in Progress," and detailed status logs.

- **Project Definition:**
  - A "Project" is defined as a directory containing a metadata file.
  - **Lazy Creation:** To preserve disk sanctity, `project.yaml` files are only created when a user explicitly modifies a project (e.g., adds a tag), not during the initial scan.
  - All subdirectories and files within are considered parts of that Project.
  - Nested metadata files (projects within projects) are not permitted.
  - **Zip Attachments:** Existing `.zip` or archive files found *inside* a project folder are treated as "Project Attachments". They are cataloged but **not** mounted as folders or extracted; they serve as backup/source containers.

- **Import & Folder Structure:**
  - **Archive Import:** Native support for importing ZIP files. The system **automatically extracts** uploaded Archives into new, dedicated Project folders. Supports bulk import of multiple archives simultaneously, extracting them into the Staging Area for review.
  - **External Enrichment:** Detects model source (e.g., Thingiverse, Printables) from imported archive contents or filenames. Automatically fetches and merges missing details (images, summary, tags) from the online platform into the local `project.yaml`.
  - **Duplicate Detection:** Automatic SHA-256 hash calculation during scan to identify and resolve duplicate files across the library.
  - **Staging Area:** A dedicated workflow for ingesting raw files. The app scans input directories and proposes project structures in a temporary view. Users review and confirm these structures before the app writes metadata and moves files to the main library.
  - **Inbox/Unsorted:** Loose files or quick downloads are handled via an "Inbox" or "Unsorted" project, requiring later promotion to a proper project structure.
  - **Import Priority:** Focus on importing individual projects to ensure adherence to the curated structure. Automatic metadata enrichment and manual verification are key steps.
  - **Ignored Patterns:** Configurable global ignore list (glob patterns) to exclude system folders (e.g., `.git`, `__MACOSX`) or specific file types (e.g., `.gcode`) from the library.
  - **Organizational Rules:** Users can define default folder structures (e.g., group by `Designer`, `Source Platform`, or `Tag`).
  - **Maintenance:** Tools provided to reorganize, rename, and clean up files to adhere to the conventions.
  - *Note:* Traditional loose folder scanning is deprioritized in favor of strict "Project" validation to ensure data integrity.

- **Search & Filter Interface:**  
  - Dynamic attribute-based filtering (e.g., date, file type, tag) derived from the local metadata.
  - **View Modes:** Multiple display options including a responsive Grid View (with adjustable zoom levels for thumbnails) and a Detailed List View allowing sorting by metadata columns.

- **File Operations:**
  - **Batch Editing:** Select multiple projects to apply changes simultaneously, such as adding tags, setting designers, or moving files to a new collection.
  - **Safe Deletion:** All delete operations use the OS Trash/Recycle Bin (`shell.trashItem`) preventing accidental permanent data loss.
  - **Structure Sync:** Renaming a project in the App automatically renames the directory on disk.
  - **Conflict Resolution:** To prevent data loss during concurrent editing (external vs. internal), the app employs a "UI Reload" strategy. If an external change is detected while editing, the save operation is disabled and the user is prompted to reload.

---

### 3.2 3D Model Visualization & Interaction

- **Interactive Preview:**  
  - **Thumbnail Generation:**
    - Defaults to generating sidecar images (`preview.png`) stored in a per-project `.cache` subfolder (e.g., `<project-folder>/.cache/preview.png`), ensuring they travel with the project on disk and can be regenerated if deleted.
    - **Cache Folder Options:** Users can choose to store thumbnails in a centralized `AppData` cache, in the library root directory, or alongside source files, with clear documentation on the implications of each choice.
    - **Customization:** Ability to "Set View as Thumbnail" from the 3D viewport or upload a custom image (e.g., photo of the printed model) to replace the auto-generated preview.
  - Utilize Three.js to render a real-time preview of each model that lacks a thumbnail. 
  - **3MF Support:** Extract geometry and metadata from `.3mf` archives for seamless previewing and data ingestion.
  - Support navigation tools such as pan, rotate, zoom, and reset view.
  - **Drag-and-Drop Export:** Native OS support to drag a model from the app directly into external software (Slicers, Blender, etc.).

- **Non-3D Asset Support:**
  - **Images (JPG/PNG):** Built-in native viewer for project reference images.
  - **Others (PDF, SCAD, TXT):** "Open in Default System App" behavior to maintain lightweight scope.

- **Basic Editing & Analysis:**  
  - Allow basic transformations (e.g., scaling, rotation) for a quick visual check.  
  - Integrate mesh analysis tools to check for errors (e.g., non-manifold edges) that might affect printing.

### 3.3 Collections & Organization

- **Physical Folder Tree:**
  - Sidebar navigation mirroring the actual disk structure (Lightroom-style), strictly scoped to the user-defined library root directories.

- **Virtual Collections:** 
  - **Persistence:** Metadata for collections is stored in a resilient JSON sidecar (`collections.json`) in the user data folder, ensuring configuration survives database rebuilds.
  - SQLite may cache collection data for performance, but it is not the source of truth.

- **Smart Collections:**
  - Dynamic saved searches (e.g., "Tag: Gridfinity AND Date: > 2024").


---

### 3.4 User Experience & Customization
  - **Project Tabs:** Multi-tab interface allowing multiple projects to be open simultaneously for quick switching and comparison without losing state.

- **Window Management:**
  - **Frameless UI:** Custom, native-feeling title bar (via `electron-titlebar` or similar) to ensure a consistent, premium aesthetic across Windows, macOS, and Linux.

- **Productivity:**
  - **Keyboard Shortcuts:** Centralized keybinding manager supporting standard shortcuts (e.g., `Ctrl+F` for search, `Del` for safe delete, `F2` to rename).
  - **Undo/Redo Strategy:** "Professional Level" transaction support. Disk operations (Rename, Move, Tag) generate inverse operations on an undo stack, preventing accidental data loss from bulk edits.

- **Dashboard:**  
  - Central view summarizing model inventory, recent activity

- **Preferences & Configuration:**  
  - Settings module for specifying default directories, file formats, theme customization, and notifications.
  
- **Notifications & Error Handling:**  
  - Real-time feedback for file changes, import errors, or print preparation issues.
  - **Hardware Checks:** Startup validation for WebGL/GPU acceleration with graceful fallback to static icons on unsupported hardware.
  - Status bar, indicating background processes like indexing, thumbnail generation
  - **Log Viewer:** A dedicated interface to view, filter, and export application logs (Main Process, Renderer, and Watcher services) to assist in troubleshooting and bug reporting.

- **Application Lifecycle:**
  - Integrated auto-update mechanism (`update-electron-app` with `@electron-forge/publisher-github`) to seamlessly deliver patches and new features.
  - User options to check for updates manually or opt-in to beta channels.

---

## 4. Development & Testing Considerations

- **Version Control:**  
  - Use Git with a clear branching strategy to manage features, bugs, and releases.

- **Agent Verification Standard:**
  - Every agent-delivered feature must ship with an executable acceptance path, typically a Playwright Electron test that launches the app, performs the user flow, and verifies the expected result.
  - Features are not considered complete when they are only implemented; they are complete when the corresponding end-to-end verification passes.
  - Electron test runs must execute against deterministic fixture data and test-specific app directories to avoid coupling to a developer's real library.
  - Where native OS dialogs or external integrations are difficult to automate directly, the app should expose narrow test seams in test mode rather than skipping verification.
  
- **Continuous Integration/Continuous Deployment (CI/CD):**  
  - Set up automated testing (unit and integration) and build pipelines to ensure code quality and simplify deployments.

- **E2E Harness Requirements:**
  - Provide a smoke test that proves Electron launches and the first renderer window becomes interactive.
  - Provide fixture-backed acceptance tests for critical file-management flows such as library setup, scan, metadata edits, import, and offline handling.
  - Capture logs, screenshots, and Playwright traces for failed runs so an agent can diagnose regressions without manual reproduction.

- **Documentation:**  
  - Maintain technical and user documentation detailing API usage, development guidelines, and troubleshooting instructions.

- **User Feedback Loop:**  
  - Incorporate local-first diagnostic logging and feedback workflows to monitor application behavior and gather user insights for iterative improvements without requiring cloud telemetry.

---

## 5. Summary & Next Steps

This document establishes the initial technical direction for your Electron-based 3D model management app. It covers the technology stack, architectural design, security considerations, and outlines the key user features that will guide further development.  

**Next Steps:**
- Flesh out detailed specifications for each module and design UI prototypes.
- Set up a minimal viable project structure to validate the technical decisions.
- Begin development of core modules (file management and 3D model preview) in parallel with testing frameworks.