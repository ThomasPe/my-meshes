# 2. Domain Model & Data Format

> Status: specification, technology-neutral. Decisions reference the question numbers
> (Q#) in `docs/open-questions.md`.

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
- Nested projects (a `project.yaml` below another project) are not permitted. A nested
  sidecar is reported as a scanner note on the enclosing project and otherwise ignored.
- Project identity is the directory. Renaming the project in the app renames the
  directory on disk.
- A project without `project.yaml` is still a project; its title defaults to the
  directory name and its metadata is derived (file list, sizes, dates).
- **Boundary rule (decided Q10):** walking top-down from the root, the first directory
  that directly contains a model file or a `project.yaml` is a project, and everything
  beneath it belongs to that project. Directories without models of their own are only
  structure. `Gridfinity/Bins/*.stl` and `Gridfinity/Lids/*.stl` are two projects;
  `Robotics/Arm v4/` with `stl/` below it is one. A future `boundary: here` key in a
  sidecar may force a boundary where the heuristic guesses wrong.
- **Download bundles (added 2026-10-18):** Printables, MakerWorld and Thingiverse zips
  unpack to a folder with images and a README at the top and the models in `files/`,
  `stl/` or similar. Such a folder is one project, not a project called "files": a
  directory without models of its own is a project when at least one container-named
  child (`files`, `stl`, `stls`, `3mf`, `obj`, `models`, `meshes`, `3d`, `print files`;
  the list is a setting) directly holds models, and the directory either carries images
  or documents itself or contains nothing but container children. A category folder like
  `Gridfinity/` with `Bins/` and `Lids/` is unaffected because those names are not
  containers.

### Files inside a project
| Kind | Examples | Handling |
|---|---|---|
| Model | `.stl`, `.obj`, `.3mf` (previewable); `.step`/`.stp`, `.ply`, `.amf` (indexed as models, preview later) | Indexed, thumbnail source. 3MF geometry and embedded thumbnails are extracted; a 3MF produced by a slicer (Bambu, Prusa) is a model with a "slicer project" badge derived from its metadata, not a separate concept (Q11). |
| Image | `.jpg`, `.png`, `.webp` | Indexed, shown in the built-in image viewer, candidate for project thumbnail |
| Document | `.pdf`, `.txt`, `.md`, `.scad`, `.blend`, `.f3d` | Indexed, opened with the OS default application |
| Attachment | `.zip`, `.7z`, `.rar` found *inside* a project | Cataloged as opaque attachments. Never mounted or extracted |
| Ignored | `.gcode`, `.git/`, `__MACOSX/`, `.DS_Store`, … | Excluded via a user-editable global ignore list (glob patterns) |

### Inbox (Unsorted)
A designated folder `_Inbox` directly below a library root that collects loose files
and quick downloads. It has its own sidebar view and a "make this a project" action.
Items in the inbox are expected to be promoted into proper projects later (Q6).

### Staging Area
A review step for imports, not a place on disk. Implemented (D3): a native drop or the
picker opens the staging dialog; archives (zip) and folders are proposed as projects,
loose files for the inbox; a zip with a single top-level folder has it stripped so the
project folder replaces it. Paths that would escape the target (zip-slip) are skipped
with a warning. 7z and rar are not extracted yet. Dropped archives or scanned input folders
are analyzed and the app proposes a project structure; single files are proposed for the
inbox. Nothing is written to the library until the user confirms (Q6). After extracting
an archive into a new project, the original archive is **kept as an attachment inside the
project by default**; settings allow moving it to `_Originals` below the root or sending
it to the Recycle Bin. The import dialog shows the space each choice costs (Q7).

### Collection
A user-defined, ordered set of projects independent of the folder structure.

### Smart Collection
A saved query (e.g. `tag = gridfinity AND created > 2024-01-01`) evaluated live.

## Sidecar format: `project.yaml`

Human-readable, diff-friendly, inspired by 3MF core metadata and Dublin Core.

```yaml
schema: 1                                 # format version, for migrations

metadata:
  title: "Gridfinity Storage Bin"         # dc:title
  creator: "Zach Freedman"                # dc:creator / 3MF designer
  license: "CC-BY-NC-SA-4.0"              # SPDX identifier where possible; dc:rights
  source_url: "https://thangs.com/..."    # dc:identifier, canonical URL
  source:                                 # optional, filled by enrichment (phase 2)
    platform: thangs
    id: "123456"
  description: "Parametric bins for the Gridfinity system."
  tags:
    - gridfinity
    - organizer
  created: 2024-03-02                     # date added to the library

printing:                                 # only what you filter by; slicer settings stay in the slicer
  recommended_material: "PLA"
  supports_required: false
  notes: "0.2 mm layers, 15% infill"

files:                                    # optional per-file annotations
  - path: "Bin_1x1.stl"
    description: "Standard single bin"
    quantity: 4

thumbnail: ".cache/preview.png"           # relative path; absent = auto-generated
```

Decided (Q4): the file name stays `project.yaml`; `schema` stays; the printing block is
limited to material, supports and free-text notes; per-file `quantity` stays.

Rules:
- **Lazy creation.** `project.yaml` is only written when the user changes metadata.
  Scanning never creates or modifies sidecars.
- Unknown keys are preserved on write so external tools can extend the file.
- Writes are atomic (write temp file, then rename).
- **Conflict handling.** If the sidecar changed on disk while the user is editing it, the
  save is blocked and the user is asked to reload ("UI reload" strategy).

## Collections store: `collections.json`

Manual collections and smart collection definitions are stored in a JSON file in the
user's application data directory so they survive cache rebuilds. Decided (Q9): they stay
in app data because collections span roots and a NAS root should not carry one app's
files; export/import of the file is a later feature for sharing between machines.

```json
{
  "schema": 1,
  "favorites": ["<root-id>:Gridfinity/Bins"],
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
is remounted under a different absolute path. Favorites live here too (implemented): they
are a per-user view, not project metadata, so they do not go into `project.yaml`, and they
must survive an index rebuild, so they do not live only in the index. A rename moves the
reference along.

## Thumbnails and cache

- Default thumbnail location (decided Q5): the **app data cache**
  (`<app data>\thumbs\<key>.png`). Rendering a preview never writes into a project
  folder, no hidden folders travel with zipped or shared projects, and the scan-never-writes
  rule stays intact. Thumbnails are reproducible, so losing them on reinstall is acceptable.
- Implemented keying: `<key>` is a hash of project id + source file path, so re-rendering
  overwrites instead of accumulating files. The index remembers the source file's size and
  mtime; when they change the thumbnail counts as stale and the project re-enters the queue.
  A full content hash was rejected for this: it would mean reading every model twice.
- Source priority: the image named by `thumbnail:` in the sidecar, else a 3MF with an
  embedded preview (extracted, no rendering), else the largest previewable model (STL,
  OBJ, 3MF) rendered off-thread, else the first image in the project. Failures are
  recorded per source state and not retried until the file changes.
- Alternative location (user setting): `<project>/.cache/preview.png` for people who
  want previews to travel with the project.
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
