# 2. Domain Model & Data Format

> Status: specification, technology-neutral. Open points are marked **[Q#]** and listed
> in `docs/open-questions.md`.

## Core concepts

### Library Root
A directory the user registers as part of their library. The app only ever reads and
writes inside library roots. A root may live on a local disk, an external drive or a
network share. Each root has a sync mode (watched, polled, manual) and an
online/offline state.

### Project
The unit the user browses and curates. A project is a directory inside a library root
that contains model files and, optionally, a metadata sidecar `project.yaml`.

- All files and subdirectories inside a project directory belong to that project.
- Nested projects (a `project.yaml` below another project) are not permitted. **[Q10]**
- Project identity is the directory. Renaming the project in the app renames the
  directory on disk.
- A project without `project.yaml` is still a project; its title defaults to the
  directory name and its metadata is derived (file list, sizes, dates). **[Q10]** defines
  how directories without a sidecar are grouped into projects.

### Files inside a project
| Kind | Examples | Handling |
|---|---|---|
| Model | `.stl`, `.obj`, `.3mf` | Indexed, previewable, thumbnail source. 3MF geometry and embedded thumbnails are extracted. **[Q11]** |
| Image | `.jpg`, `.png`, `.webp` | Indexed, shown in the built-in image viewer, candidate for project thumbnail |
| Document | `.pdf`, `.txt`, `.md`, `.scad` | Indexed, opened with the OS default application |
| Attachment | `.zip`, `.7z`, `.rar` found *inside* a project | Cataloged as opaque attachments. Never mounted or extracted |
| Ignored | `.gcode`, `.git/`, `__MACOSX/`, `.DS_Store`, … | Excluded via a user-editable global ignore list (glob patterns) |

### Inbox (Unsorted)
A designated project that collects loose files and quick downloads. Items in the inbox
are expected to be promoted into proper projects later. **[Q6]**

### Staging Area
A review step for imports. Dropped archives or scanned input folders are analyzed and
the app proposes a project structure. Nothing is written to the library until the user
confirms. **[Q6]**, **[Q7]**

### Collection
A user-defined, ordered set of projects independent of the folder structure.

### Smart Collection
A saved query (e.g. `tag = gridfinity AND created > 2024-01-01`) evaluated live.

## Sidecar format: `project.yaml`

Human-readable, diff-friendly, inspired by 3MF core metadata and Dublin Core.

```yaml
schema: 1                                 # format version, for migrations [Q4]

metadata:
  title: "Gridfinity Storage Bin"         # dc:title
  creator: "Zach Freedman"                # dc:creator / 3MF designer
  license: "CC-BY-NC-SA-4.0"              # SPDX identifier where possible; dc:rights
  source_url: "https://thangs.com/..."    # dc:identifier
  description: "Parametric bins for the Gridfinity system."
  tags:
    - gridfinity
    - organizer
  created: 2024-03-02                     # date added to the library

printing:                                 # Schema.org/3DModel-like technical hints
  recommended_material: "PLA"
  supports_required: false
  notes: "0.2 mm layers, 15% infill"

files:                                    # optional per-file annotations
  - path: "Bin_1x1.stl"
    description: "Standard single bin"
    quantity: 4

thumbnail: ".cache/preview.png"           # relative path; absent = auto-generated
```

Rules:
- **Lazy creation.** `project.yaml` is only written when the user changes metadata.
  Scanning never creates or modifies sidecars.
- Unknown keys are preserved on write so external tools can extend the file.
- Writes are atomic (write temp file, then rename).
- **Conflict handling.** If the sidecar changed on disk while the user is editing it, the
  save is blocked and the user is asked to reload ("UI reload" strategy).

## Collections store: `collections.json`

Manual collections and smart collection definitions are stored in a JSON file in the
user's application data directory so they survive cache rebuilds. **[Q9]** asks whether
this file should instead live in the library root so collections travel with the library.

```json
{
  "schema": 1,
  "collections": [
    { "id": "c_01", "name": "Desk setup", "projects": ["<root-id>/Gridfinity/Bins", "..."] }
  ],
  "smartCollections": [
    { "id": "s_01", "name": "Gridfinity & PLA",
      "query": { "all": [ { "tag": "gridfinity" }, { "printing.recommended_material": "PLA" } ] } }
  ]
}
```

Projects are referenced by root id plus relative path so the file stays valid when a root
is remounted under a different absolute path.

## Thumbnails and cache

- Default thumbnail location: `<project>/.cache/preview.png` so previews travel with the
  project and can be regenerated when deleted. **[Q5]**
- Alternative locations (user setting): centralized app-data cache, or a `.cache`
  folder at the library root.
- A user-provided image ("set view as thumbnail", or an uploaded photo) replaces the
  generated preview and is referenced from `project.yaml`.

## Index (cache database)

An embedded database indexes projects, files, tags and full-text search over titles,
descriptions, tags and file names. It is **read-only from the user's perspective**: it is
rebuilt from disk whenever needed and never holds data that does not also exist on disk,
with one exception: per-file content hashes (SHA-256) used for duplicate detection may
be cached there because recomputing them is expensive.

## State machine for a library root

```
registered ──scan──▶ indexed ──watch/poll──▶ in sync
    │                   │                       │
    └── path missing ───┴──────▶ offline ◀──────┘
                                   │ path reappears + rescan
                                   ▼
                                indexed
```

Items under an offline root remain in the index, are shown with an offline marker and
cannot be opened or modified until the root is back.
