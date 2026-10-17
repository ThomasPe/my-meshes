# 1. Vision & Scope

> Status: specification, technology-neutral. Technology choices live in `docs/decisions/`.

## Purpose

A desktop application that helps makers organize, preview and prepare the 3D model
files (STL, OBJ, 3MF, …) they already have on their own disks. It brings the browsing
experience of online model repositories (Thingiverse, MyMiniFactory, MakerWorld, Thangs)
to a local, offline library.

## Goals

1. **Browse and manage local models intuitively.** A visual library with thumbnails,
   tags, search and filters over files stored on local drives, external drives or a NAS.
2. **Organize efficiently.** Tag, categorize and collect models; keep the folder
   structure on disk clean through conventions and maintenance tools.
3. **Ingest new models easily.** Drag-and-drop or folder scanning; archives downloaded
   from model repositories become curated projects with minimal effort.
4. **Hand off to printing tools.** Preview a model, then get it into a slicer with one
   drag.

## Platforms & distribution

1. **Windows** is the primary platform. Private builds first, then a public release
   through the **Microsoft Store** (MSIX).
2. **macOS** is a stretch goal, distributed through the **Mac App Store** (sandboxed).
3. **Linux** is out of scope for v1. Nothing in the design should preclude it later.

## Non-goals (for now)

- Slicing, G-code generation or printer control.
- Cloud sync, sharing, accounts or any online service dependency.
- Mesh repair beyond basic analysis (deferred to a later phase, see backlog Epic 9).

## Guiding principles

- **Local source of truth.** Everything the user curates (metadata, tags, custom
  thumbnails) lives on disk next to the models in human-readable files. Any database is
  a disposable cache that can be rebuilt from disk at any time.
- **Offline first, private by default.** No telemetry. No upload of file content or
  metadata. Online features (metadata enrichment) are explicit, opt-in and per action.
- **Never lose data.** Deletes go to the OS trash. Disconnected drives mark items as
  offline instead of removing them. Disk writes are undoable where feasible.
- **Fast at scale.** Libraries with tens of thousands of files must stay responsive;
  heavy work (hashing, parsing, thumbnailing) never blocks the UI.
- **Verifiable by agents.** Every feature ships with an executable end-to-end check that
  drives the real desktop app against deterministic fixture data (see `04-quality.md`).

## Inspiration

| Product | What we borrow |
|---|---|
| Adobe Lightroom | Folder tree + virtual collections + smart collections; grid with zoomable thumbnails; sidecar metadata |
| Plex | Library roots, background scanning, automatic enrichment of local media |
| Thingiverse / MyMiniFactory / MakerWorld / Thangs | Card-based browsing, tags, designer and license metadata, file lists per "thing" |

## Reference mockup

`docs/mockups/reference-mockup.png` shows the intended information architecture: a
sidebar with library views, smart collections and the physical folder tree; a tabbed main
area with a zoomable thumbnail grid; a status bar with sync state. Interactive HTML
mockups exploring different visual directions are in `docs/mockups/`.
