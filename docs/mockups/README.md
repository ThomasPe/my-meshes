# UI Mockups

Static, framework-free HTML mockups of the library screen in four visual directions.
Open `index.html` in a browser for the side-by-side comparison, or any single mockup:

| File | Direction |
|---|---|
| `a-studio.html` | Studio (shadcn/ui look) |
| `b-fluent.html` | Fluent (Windows 11 look) |
| `c-workbench.html` | Workbench (dense pro tool) |
| `d-gallery.html` | Gallery (light-first consumer look) |

Each mockup shares the same markup, data and a light/dark toggle (half-circle button in
the title bar); only the CSS differs. `shared/mock.js` injects the placeholder SVG
thumbnails and wires the toggle. Designed for a desktop viewport of 1200 px or wider.

`reference-mockup.png` is the original concept image that defined the information
architecture. The evaluation and recommendation are in
[`../decisions/0002-ui-framework.md`](../decisions/0002-ui-framework.md).
