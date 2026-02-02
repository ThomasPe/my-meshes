# 3D Model Manager
*Initial Technical Document*

## 1. Overview

**Purpose:**  
This application is designed to help users organize, preview, and prepare local 3D model files (e.g., STL, OBJ) for 3D printing. By leveraging Electron, the app can run on major platforms (Windows, macOS, Linux) while offering a seamless, native desktop experience.

**Goals:**
- Provide an intuitive interface for browsing and managing 3D model files stored on a hard drive.
- Render 3D models interactively using built-in visualization tools.
---

## 2. Technical Decisions

### 2.1 Technology Stack

| Layer              | Technology(s)                                        | Rationale                                                                                  |
|--------------------|------------------------------------------------------|--------------------------------------------------------------------------------------------|
| **Application Base** | Electron, Electron Forge, Typescript                                         | Cross-platform desktop application packaging and native integration                        |
| **Frontend UI**    | React, [Radix Themes](https://www.radix-ui.com/themes), [Radix UI](https://www.radix-ui.com/), Tailwind CSS | Component-based architecture with accessible primitives and utility-first CSS               |
| **Routing & State** | TBD | |
| **File System Access** | TBD  |     |
| **Bundling & Building** | Vite                                   | Effective asset bundling with optimized builds for production                                |
| **Testing**        | Vitest (unit tests), Playwright (e2e tests) | Ensures components work individually and the app functions as a whole                          |
| **Code Quality**   | ESLint, Prettier                                     | Maintain clear, consistent coding standards throughout the project                           |
| **Internationalization** | i18next, react-i18next                        | Support for multiple languages and localization                                            |



## 3. Core Features

### 3.1 File Management

- **Folder Scanning & Import:**  
  - Automatically scan specified directories for supported 3D file formats (e.g., STL, OBJ).  
  - Allow manual import or directory selection.
  - Model files in the same folder are treated as parts of a single multi-part model (e.g. for search purposes)

- **Metadata & Tagging:**  
  - Extract and display basic file metadata (size, date modified, etc.).  
  - Provide options for user-added tags or categorization for easier search and filtering.
  - Fields for metdadata like License, URL to source, author

- **File Operations:**  
  - Enable operations such as rename, delete, copy/move—all within the app.
  - Auto-cleanup function to reorder & rename files based on specified rules

- **Search & Filter Interface:**  
  - Include dynamic search capabilities with attribute-based filtering (e.g., date, file type, tag).

---

### 3.2 3D Model Visualization & Interaction

- **Interactive Preview:**  
  - Utilize Three.js to create cached thumbnails
  - Utilize Three.js to render a real-time preview of each model.  
  - Support navigation tools such as pan, rotate, zoom, and reset view.

- **Basic Editing & Analysis:**  
  - Allow basic transformations (e.g., scaling, rotation) for a quick visual check.  
  - Integrate mesh analysis tools to check for errors (e.g., non-manifold edges) that might affect printing.


---

### 3.4 User Experience & Customization

- **Dashboard:**  
  - Central view summarizing model inventory, recent activity

- **Preferences & Configuration:**  
  - Settings module for specifying default directories, file formats, theme customization, and notifications.
  
- **Notifications & Error Handling:**  
  - Real-time feedback for file changes, import errors, or print preparation issues.
  - Status bar, indicating background processes like indexing, thumbnail generation
  - Log history

- **Future Proofing:**  
  - A plugin system for future features, such as cloud integration for model backups or sharing.

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