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

** Similar applications &  inspiration**:
- **Photoshop Lightroom**: For photo organization and management.
- **Plex**: For media file organization and streaming.
- **3D Model Repositories**: Thingiverse, MyMiniFactory, Makerworld, Thangs

## 2. Technical Decisions

### 2.1 Technology Stack

| Layer              | Technology(s)                                        | Rationale                                                                                  |
|--------------------|------------------------------------------------------|--------------------------------------------------------------------------------------------|
| **Application Base** | Electron, Electron Forge, Typescript                                         | Cross-platform desktop application packaging and native integration                        |
| **Updates**          | electron-updater                                                             | Over-the-air auto-updates for bug fixes and features                                       |
| **Frontend UI**    | React, [Radix Themes](https://www.radix-ui.com/themes), [Radix UI](https://www.radix-ui.com/), Tailwind CSS | Component-based architecture with accessible primitives and utility-first CSS               |
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

- **Worker Threads:** CPU-intensive tasks (STL parsing, geometry analysis) execute in Node.js Worker Threads. 
- **Offscreen Rendering:** Thumbnail generation utilizes Electron's hidden BrowserWindow (offscreen rendering) to access WebGL contexts correctly, avoiding "headless" limitations.
- **IPC Pattern:** Strict `Context Isolation` usage. The frontend requests actions (e.g. `scanProject`) via a secure API bridge; the Main process handles the disk I/O.
- **Virtual Lists:** The UI will use list virtualization (e.g. `react-window`) to performantly render libraries with thousands of items.

### 2.4 Privacy & Security

- **Offline First:** The application operates entirely locally. No telemetry, metadata, or file content is uploaded to the cloud.
- **Local Processing:** All analysis, thumbnail generation, and indexing occur on the user's machine.

## 3. Core Features

### 3.1 File Management & Storage Strategy

- **Local Source of Truth:**
  - All metadata and assets (images, SCAD, PDFs) must be stored on disk alongside the model files.
  - A text-based description file (e.g. JSON/YAML) serves as the source of truth for each "Project". 
  - A database (e.g., SQLite) serves as a **read-only cache** for performance/indexing.
  - **File Sync:** A robust file watcher service monitors file system events.
    - **Network/NAS Support:** Includes fallback modes for non-watchable volumes (e.g., Polled Refresh, Manual Rescan).
    - **Sync Status:** UI indicators for "Last Sync Time," "Syncing in Progress," and detailed status logs.

- **Project Definition:**
  - A "Project" is defined as a directory containing a metadata file.
  - All subdirectories and files within are considered parts of that Project.
  - Nested metadata files (projects within projects) are not permitted.

- **Import & Folder Structure:**
  - **Archive Import:** Native support for importing ZIP files. Each archive is treated as a distinct Project. Supports bulk import of multiple archives simultaneously, extracting them into the Staging Area for review.
  - **External Enrichment:** Detects model source (e.g., Thingiverse, Printables) from imported archive contents or filenames. Automatically fetches and merges missing details (images, summary, tags) from the online platform into the local `project.yaml`.
  - **Duplicate Detection:** Automatic SHA-256 hash calculation during scan to identify and resolve duplicate files across the library.
  - **Staging Area:** A dedicated workflow for ingesting raw files. The app scans input directories and proposes project structures in a temporary view. Users review and confirm these structures before the app writes metadata and moves files to the main library.
  - **Inbox/Unsorted:** Loose files or quick downloads are handled via an "Inbox" or "Unsorted" project, requiring later promotion to a proper project structure.
  - **Import Priority:** Focus on importing individual projects to ensure adherence to the curated structure. Automatic metadata enrichment and manual verification are key steps.
  - **Organizational Rules:** Users can define default folder structures (e.g., group by `Designer`, `Source Platform`, or `Tag`).
  - **Maintenance:** Tools provided to reorganize, rename, and clean up files to adhere to the conventions.
  - *Note:* Traditional loose folder scanning is deprioritized in favor of strict "Project" validation to ensure data integrity.

- **Search & Filter Interface:**  
  - Dynamic attribute-based filtering (e.g., date, file type, tag) derived from the local metadata.

- **File Operations:**
  - **Batch Editing:** Select multiple projects to apply changes simultaneously, such as adding tags, setting designers, or moving files to a new collection.
  - **Safe Deletion:** All delete operations use the OS Trash/Recycle Bin (`shell.moveItemToTrash`) preventing accidental permanent data loss.
  - **Structure Sync:** Renaming a project in the App automatically renames the directory on disk.
  - **Conflict Resolution:** To prevent data loss during concurrent editing (external vs. internal), the app employs a "UI Reload" strategy. If an external change is detected while editing, the save operation is disabled and the user is prompted to reload.

---

### 3.2 3D Model Visualization & Interaction

- **Interactive Preview:**  
  - **Thumbnail Generation:**
    - Defaults to generating sidecar images (`preview.png`) stored alongside the model files.
    - Global preference available to switch to a centralized `AppData` cache to keep source folders clean.
  - Utilize Three.js to render a real-time preview of each model.  
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

- **Virtual Collections:** 
  - **Persistence:** Metadata for collections is stored in a resilient JSON sidecar (`collections.json`) in the user data folder, ensuring configuration survives database rebuildstructure.
  - Stored strictly in the SQLite cache (restorable via backup, but not essential for file integrity).

- **Smart Collections:**
  - Dynamic saved searches (e.g., "Tag: Gridfinity AND Date: > 2024").


---

### 3.4 User Experience & Customization

- **Dashboard:**  
  - Central view summarizing model inventory, recent activity

- **Preferences & Configuration:**  
  - Settings module for specifying default directories, file formats, theme customization, and notifications.
  
- **Notifications & Error Handling:**  
  - Real-time feedback for file changes, import errors, or print preparation issues.
  - **Hardware Checks:** Startup validation for WebGL/GPU acceleration with graceful fallback to static icons on unsupported hardware.
  - Status bar, indicating background processes like indexing, thumbnail generation
  - Log history

- **Application Lifecycle:**
  - Integrated auto-update mechanism (`electron-updater`) to seamlessly deliver patches and new features.
  - User options to check for updates manually or opt-in to beta channels.

---

## 4. Development & Testing Considerations

- **Version Control:**  
  - Use Git with a clear branching strategy to manage features, bugs, and releases.
  
- **Continuous Integration/Continuous Deployment (CI/CD):**  
  - Set up automated testing (unit and integration) and build pipelines to ensure code quality and simplify deployments.

- **Documentation:**  
  - Maintain technical and user documentation detailing API usage, development guidelines, and troubleshooting instructions.

- **User Feedback Loop:**  
  - Incorporate analytics/logging to monitor application behavior and gather user insights for iterative improvements.

---

## 5. Summary & Next Steps

This document establishes the initial technical direction for your Electron-based 3D model management app. It covers the technology stack, architectural design, security considerations, and outlines the key user features that will guide further development.  

**Next Steps:**
- Flesh out detailed specifications for each module and design UI prototypes.
- Set up a minimal viable project structure to validate the technical decisions.
- Begin development of core modules (file management and 3D model preview) in parallel with testing frameworks.