# ADR-0002: UI framework and visual direction

- Status: **accepted** 2026-10-17: **D Gallery** as the visual direction. Component library to be confirmed against the click dummy (Mantine is the default candidate; see Decision).
- Date: 2026-10-17
- Related: ADR-0001 (shell). Every option below works in Electron and Tauri.

## Context

The archived implementation used React + shadcn/ui (Radix primitives) + Tailwind. Before
rebuilding, the visual direction and the component layer are re-examined. Because the
choice of a component library largely *is* a choice of look and feel, four HTML-only
mockups of the same screen (library grid with sidebar, tabs, inspector and status bar)
were built in `docs/mockups/`. They use no framework; each one imitates the visual
language a given library produces out of the box, so the comparison is about what the
product should look like, with the library that gets there with the least fighting.

Open the comparison at `docs/mockups/index.html`, or the individual files:

| Mockup | Direction | Imitates | Best-fit libraries |
|---|---|---|---|
| A `a-studio.html` | **Studio**: zinc neutrals, 6 px radii, hairline borders, neutral primary | shadcn/ui | shadcn/ui (React), shadcn-svelte, shadcn-vue |
| B `b-fluent.html` | **Fluent**: Windows 11 Mica-like layers, 8 px cards, system accent, Explorer-style nav pane | Fluent 2 | Fluent UI React v9; Fluent Web Components (framework-agnostic) |
| C `c-workbench.html` | **Workbench**: dense pro tool, 12 px type, 3 px radii, graphite, mono data, amber accent | Blender / Lightroom / VS Code | Custom tokens on headless primitives (Radix Primitives, Base UI, Ark UI); Radix Themes compact scale |
| D `d-gallery.html` | **Gallery**: light-first, image-led, 14 px radii, soft shadows, pill chips, teal accent | Thingiverse / MakerWorld | Mantine; Tailwind + DaisyUI; shadcn with a large radius token |

All four share the same markup and content and have a light/dark toggle, so the
comparison is purely about treatment.

## Evaluation criteria

| Criterion | Why it matters here |
|---|---|
| Density | A library manager is a browsing tool; thousands of items, a folder tree, an inspector. Too airy wastes space, too dense tires casual users. |
| Native feel per OS | Windows 11 users expect Fluent; macOS users expect something lighter. A neutral look (A, C) ages well on all three; B is excellent on Windows and foreign elsewhere. |
| Theming effort | Light + dark + system are MVP (APP-2). Token-based libraries make this cheap. |
| Accessibility | Keyboard navigation and focus states throughout (`spec/04-quality.md`). Headless primitives and Fluent are strongest; hand-rolled CSS is weakest. |
| Component coverage | Needed soon: tree view, virtualized grid/list, tabs, command palette, context menus, dialogs, toasts, sliders, data table, resizable panels. |
| Agent productivity | Agents are most fluent in Tailwind + shadcn and plain CSS; Fluent v9 and Mantine have larger, more specific APIs to learn. |
| Framework lock-in | shadcn copies source into the repo (no runtime dependency, but React-bound unless using the Svelte/Vue ports). Fluent Web Components and Ark UI are framework-agnostic. |
| Bundle and startup | Irrelevant in Electron; mildly relevant in Tauri. All options are fine. |

## Assessment per mockup

**A Studio.** Lowest-risk choice: proven in the archived version, huge ecosystem,
agents know it. Dark variant is close to the reference mockup. Weakness: it looks like
every other 2024–2026 developer tool, and the default density is a touch loose for a
browsing-heavy app; a compact spacing scale and a 1:1 or 4:3 thumbnail grid fix that.

**B Fluent.** Closest to the reference image and to what a Windows-first audience
expects; translucent layering and the accent colour give it a premium feel. Weaknesses:
Fluent UI React v9 is a heavier API and its default styling engine (Griffel) is less
familiar to agents; Mica-like effects must be faked in a webview; the look is wrong on
macOS and Linux unless a second theme is maintained. A good fit if Q1 says "Windows
first".

**C Workbench.** Best density and information hierarchy for power users with large
libraries; the mono data column and the grid-paper thumbnails give it a clear identity
that none of the other options have. Weaknesses: needs a custom design system (more
upfront work, more to maintain) and may feel austere to hobbyists. Best built on
headless primitives with hand-written tokens, which agents handle well.

**D Gallery.** Most inviting for casual users and the only light-first option; large
square thumbnails suit image-led browsing. Weaknesses: lowest density, so it scales
worst to big libraries and the inspector gets crowded; the consumer look fights with a
power feature set (tabs, smart collections, batch editing).

## Recommendation

- If the answer to Q1 is "all platforms equal": **A (Studio) with C's density**, i.e.
  shadcn/ui with a compact spacing scale, square thumbnails, and C's mono data column in
  the inspector. This keeps the proven stack and agent fluency while fixing A's main
  weakness.
- If Q1 is "Windows first, others best-effort": **B (Fluent)**, built with Fluent UI
  React v9, accepting a plainer fallback theme elsewhere.
- Pick **C** outright if you see yourself as the primary user and want the tool to feel
  like Blender or Lightroom; pick **D** only if a wider, less technical audience is the
  goal.

The frontend framework stays **React** in all cases except when Fluent Web Components
or Ark UI is chosen deliberately to stay framework-agnostic; Svelte 5 and SolidJS were
considered and rejected for now because the gain (smaller bundles, simpler reactivity)
does not outweigh the loss of ecosystem depth for virtualized lists, Three.js bindings
and agent familiarity.

## Update 2026-10-17 after Q1

Windows is the primary platform and macOS a stretch goal. That raises **B (Fluent)**
from "only if Windows first" to a serious contender: on the platform nearly all users
will run, it is the look they expect, and the Store listing will sit next to native
apps. The neutral options (A, C) remain the safer choice for the macOS stretch goal,
where Fluent looks foreign. Practical compromise if B is chosen: build on tokens so
that a quieter macOS theme is a token swap, not a redesign.

## Decision (2026-10-17)

**Direction D "Gallery"** is chosen: light-first with a full dark theme, image-led
square thumbnails, 14 px radii, soft shadows, pill chips, teal accent, Manrope.

Before any framework code is written, a **multi-page HTML click dummy** in this style
validates the direction across all MVP screens: `docs/clickdummy/index.html` (welcome,
library grid and list, project detail with viewer, import staging and inbox,
collections with smart collection editor, activity, settings). It is plain HTML, CSS
and vanilla JavaScript with hash routing; its tokens (`:root` block) are the seed for
the real design system.

Component library: **Mantine** is the default candidate for D (rich component set
including tree, tabs, combobox, notifications and modals; token-based theming; React).
Confirm or replace it during the scaffold once the dummy has been reviewed; shadcn/ui
with a 14 px radius token remains the fallback if Mantine's styling model fights the
dummy's look.

## Consequences

- The chosen mockup becomes the reference for the "UI foundation" scaffold item: tokens,
  spacing scale, typography and the app shell layout.
- Mockups are kept as static HTML in `docs/mockups/` for future reference; they are not
  code to reuse.
