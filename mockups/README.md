# UI Mockups — "Private model library" direction

The original [`../mockup.png`](../mockup.png) explores a **Lightroom-style** layout: folder tree on the left,
dense grid, tabs per project, status bar. These five mockups explore the alternative the README names as
inspiration: the app as a **private MakerWorld / Thingiverse / Thangs** — a catalogue you browse, not a file
manager you navigate.

| # | Screen | File |
|---|--------|------|
| 1 | Home / dashboard | [`01-home.png`](01-home.png) · [`01-home.html`](01-home.html) |
| 2 | Browse & search with facets | [`02-browse.png`](02-browse.png) · [`02-browse.html`](02-browse.html) |
| 3 | Model page ("thing" page) | [`03-model.png`](03-model.png) · [`03-model.html`](03-model.html) |
| 4 | Designers | [`04-designers.png`](04-designers.png) · [`04-designers.html`](04-designers.html) |
| 5 | Collections (boards) | [`05-collections.png`](05-collections.png) · [`05-collections.html`](05-collections.html) |

## What changes compared to the Lightroom direction

| Lightroom-style (`mockup.png`) | Community-library style (these mockups) |
|---|---|
| Folder tree is the primary navigation | Top navigation: Home · Browse · Collections · Designers · Makes. Folders on disk are *one* "browse by" entry, not the spine of the app |
| Grid of files, project tabs | Big image-led cards with designer, source platform, license, "Printed ×n" badge, file count |
| Selection + inspector sidebar | A full **model page** per project: gallery (generated preview, plate layout, own print photos), print profile from the 3MF, tags, description, files, makes |
| Metadata lives in a panel | **Designers** are first-class: a profile per creator built from local `project.yaml` data, with links to their Printables/MakerWorld page |
| Smart/virtual collections in the tree | **Collections are boards** with collage covers; smart collections show their rules; "Save search as smart collection" from any filter state |
| Status bar carries sync | Sync status moves into the header; hero/dashboard surfaces inbox, recent imports, "continue where you left off" |

Everything stays **offline-first**: all data shown (designer, license, source URL, print profile) comes from
`project.yaml`, the 3MF metadata and the local cache. "Source ↗" links open the original page in the browser;
nothing is fetched while browsing.

## Screen notes

1. **Home** — greeting + library stats, quick actions (Import ZIPs, Scan folder, Review Inbox), "Continue where
   you left off", "Recently imported", pinned collections, designers you collect, activity feed (imports, prints
   logged, batch tags, duplicate findings).
2. **Browse** — category chips (derived from tags/organizational rules), facet filters with counts (print status,
   source platform, license, material, files, date range), active-filter pills, sort, grid/list density. Hover state
   on a card shows "Open in slicer" and quick actions. Any filter state can be saved as a smart collection.
3. **Model page** — gallery with generated preview, plate layout and own print photos ("makes"); primary actions
   *Open in slicer*, *Log a print*, add to collection, favourite; print profile parsed from the 3MF; tags; description
   fetched at import time; collections membership; files tab with per-file type, size, duplicate hint and actions.
   Attachments (ZIPs) are listed read-only.
4. **Designers** — A–Z list with platform marks and counts on the left; profile on the right with stats, platform
   links, "Favorite designer", "Smart collection" (= designer filter saved), tag summary and the designer's models.
   A note makes clear the profile is derived from local metadata; "Merge duplicates" handles name variants.
5. **Collections** — "Browse by" auto-groupings (designers, tags, source platform, folders on disk), pinned boards,
   all boards with collage covers. Smart boards carry a ⚡ badge and show their rules as chips. A dashed "New
   collection — or drop models here" card supports drag-and-drop.

## Regenerating

The mockups are plain HTML (no build step) and open directly in a browser. Thumbnails are procedural Three.js
renders of invented models; designers and models are fictional.

```bash
cd mockups/tools
npm install
npm run thumbs   # renders assets/thumbs/*.jpg (headless Chromium + WebGL)
npm run shots    # screenshots 0N-*.html → 0N-*.png at 1440×900 @1.5x
```

`CHROMIUM_PATH` can point to a Chromium binary if Playwright's default is not installed.
