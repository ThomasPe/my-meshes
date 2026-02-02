# Copilot Instructions for "My Meshes" 3D Model Manager

## Project Architecture
- **Core Stack:** Electron + Vite + React + TypeScript.
- **Data Model:** 
  - **Local Source of Truth:** The file system and `project.yaml` sidecar files are the authority. 
  - **Database:** SQLite (`better-sqlite3`) is a **read-only cache** for fast searching/filtering. It can be rebuilt from disk at any time.
  - **Project:** A folder containing files and an optional `project.yaml`. Nested projects are not allowed.

## Critical Implementation Rules

### 1. Data Integrity & Sync
- **Lazy Enrichment:** NEVER generate `project.yaml` files during a library scan. Only create/write a sidecar file when the user explicitly modifies metadata (e.g., adds a tag).
- **Optimistic UI:** When a user modifies data, update the React state immediately. Perform the disk write (YAML) and DB update (cache) in the background. Rollback state if the disk write fails.
- **Offline Protection:** If a Library Root path is missing (disconnected NAS/Drive), mark its contents as "Offline" in the UI. **DO NOT** delete records from the SQLite cache.

### 2. File Handling
- **Archives (Import):** interactions with uploaded/dragged ZIPs must **auto-extract** them into a new Project folder.
- **Archives (Existing):** ZIPs found residing inside existing folders are treated as **"Project Attachments"** (opaque, read-only backups). Do not mount them as folders.
- **3MF Files:** Treat as 3D Model files (parseable geometry), but respect their archive structure for thumbnail extraction.
- **Streams & Buffers:** **ALWAYS prefer streaming** over buffering for large file I/O to prevent Renderer OOM.
- **Worker Offloading:** **MANDATORY:** All geometry parsing (STL/OBJ/3MF) and heavy math must run in a **Web Worker**, never on the main UI thread.

### 3. Security
- **Content Security Policy:** Enforce strict CSP. No inline scripts.
- **Node Integration:** Explicitly strictly forbid `nodeIntegration: true` and `contextIsolation: false` in all BrowserWindow configurations.

### 4. UI & Styling
- **Frameless:** Use a custom title bar (e.g. `electron-titlebar` or custom component).
- **Internationalization:** Wrap **ALL** user-facing strings in `t('key')` from the start. No hardcoded text.
- **Components:** Use Radix UI primitives for behavior and Tailwind CSS for styling.
- **Performance:** Use `react-window` for the main grid view (virtualization required for large libraries).
- **Thumbnails:** Generate offscreen in a hidden window or worker, never block the main UI thread.

### 5. IPC Communication
- Use `contextBridge` for all Main <-> Renderer communication.
- Prefix IPC channels with `app:` (e.g., `app:scan-folder`, `app:get-metadata`).
- Prefer `ipcRenderer.invoke` (Promises) over `send/on` for request/response flows.

## Developer Guidelines

### Workspace & Build
- **Package Manager:** Use `npm` exclusively.
- **Scripts:**
  - `npm run dev`: Concurrent Vite server + Electron launch.
  - `npm run build`: Type-check + compile implementation.
  - `npm run make`: Generate distributables (via Electron Forge).

### Code Style & Patterns
- **TypeScript:** Strict mode enabled. No `any`. Use interfaces for IPC payloads.
- **React:** Functional components only. Use `TanStack Query` for async state (DB reads).
- **CSS:** Tailwind utility classes. Avoid CSS-in-JS libraries unless necessary for dynamic values.
- **Naming Conventions:**
  - Components: `PascalCase` (e.g., `MeshViewer.tsx`)
  - Utilities/Hooks: `camelCase` (e.g., `useMeshLoader.ts`, `fileSystem.ts`)
  - Constants: `UPPER_SNAKE_CASE`

### Debugging
- **Main Process:** Logs must go to `electron-log` file output (Standard `console.log` is invisible in production).
- **Renderer:** Use Browser DevTools.
- **IPC Debugging:** Log all `ipcRenderer.invoke` calls in dev mode to track flow.

### Quality Assurance
- **Unit Tests (Vitest):** implementation-agnostic tests for pure logic, hooks, and utilities.
- **E2E Verification (Playwright):** Full user flows and smoke tests. Iterate until acceptance criteria are met.
- **Code Standards:** Ensure all new code runs clean through `eslint` and `prettier` before considering a task complete.
