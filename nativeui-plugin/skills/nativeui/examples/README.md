# Example screens

Gold HTML/CSS screens to copy from. Each is a complete standalone document in the NativeUI authoring format
(see `../references/authoring-rules.md`).

- **responsive-animated-home.html** — a dashboard that demonstrates the core patterns in one file:
  - mobile-first 412×915 stage
  - `@keyframes` animations → the NativeUI timeline (a pulsing live dot, a sliding hero, a `:hover` CTA glow)
  - responsive `@media` breakpoints → smart divisions (stat grid: 1-col phone → 2-col @600px → 3-col @900px)
  - gradients, shadows, border-radius
  - stable, letter-first ids on interactive elements (`refresh_button`, `cta`) so the backend gets typed
    accessors on both platforms
  - cross-screen navigation via `<a href="#detail">`
- **effects-clip-transforms.html** — the effects / clipping / transform surface in one screen:
  - circular avatar: a square box + `border-radius:50%` (resolves against `min(width,height)`) + `overflow:hidden` clipping an inner full-bleed `linear-gradient`, with a `dashed` border ring
  - `box-shadow: inset …` → an inner shadow well (outer offsets → drop shadow; inset keyword → inner shadow)
  - `filter: blur(6px)` tile — the one `filter` function that renders on every lane (the non-blur `filter`/`backdrop-filter` functions drop on editor + Android)
  - `clip-path: polygon(…)` carving a box into an arbitrary shape
  - `transform: rotate() scale()` (pivots at the element centre; paint-only, layout unchanged) with an absolutely-positioned `pip` badge
- **forms.html** — a sign-up screen mirroring the Forms recipe (every control mapping, one stable letter-first id each):
  - labelled `text` / `email` → TextField, `password` → PasswordField, `<textarea>` → TextArea, `<select><option selected>` → ComboBox
  - a radio group sharing one `name="payment"` → bound into a single mutual-exclusion ToggleGroup; `checkbox` + `checked`; `range` → Slider; `<button type=submit>` → Button inside a `<form>` (which also captures a SUBMIT interaction)
  - `placeholder` / `value` / `checked` carried onto each control; ids start with a letter (`full_name`, `submit_button`) so both natives get typed backend accessors
- **svg-icons-shapes.html** — the inline-SVG / vector-paint surface in one screen (every shape + paint mode imports as a real shape node):
  - a toolbar of **line icons** (24-grid, `fill="none"` + `stroke="currentColor"`) recoloured by ONE CSS `color`, and a row of **solid icons** (`fill="currentColor"`)
  - the basic shapes — `rect` / `circle` / `ellipse` / `line` / `polyline` / `polygon` — and a path-based logo
  - an SVG **`<linearGradient>`** fill (`url(#id)`), an SVG **`<clipPath>`** (a star clipping a gradient `<rect>`), and an SVG **`<text>`** label centred in a **donut / progress ring** (`stroke-dasharray` arc, `rotate(-90deg)` start)
- **borders.html** — the border surface in one screen, each block labelled with what it teaches:
  - a **multi-stroke (concentric) ring** — the real NativeUI pattern: a node's own `border` is stroke #1 and a HARD spread-only `box-shadow` (`0 0 0 <spread>px <color>`, no offset/blur, not `inset`) becomes a second concentric ring stroke #2 painted outward (verified: each ring node materializes `borderStrokes.size()==2` on the editor/native lanes). NOTE: only ONE `box-shadow` imports — a comma-separated list keeps just the first — so two stacked rings do NOT both import; combine ONE spread ring with a `border`.
  - **solid / dashed / dotted** borders, **per-side** borders (top accent / left accent / bottom divider), and **per-corner `border-radius`** via the shorthand `TL TR BR BL` (Android collapses to the top-left corner)
- **finance-dashboard.html** — a complete, realistic full app screen (a finance dashboard) showing everything coming together; adapted from the parity-verified corpus (`parity/flow-a-corpus/dashboard`):
  - a pinned `position:absolute` top bar + a scrolling body (`overflow-y:auto` → ScrollPane) + a bottom nav bar with per-item SVG icons
  - a typography scale, white **cards** with `box-shadow` + `border-radius`, a 3-tile metric row (`flex:1`), pill **badges**, and a transaction list of leading-icon + `flex:1` label + trailing amount rows
  - an SVG **area chart** card: a `<linearGradient>` area fill, a `<polyline>` line, `<circle>` point markers, grid `<line>`s, and `<text>` axis labels

In the NativeUI repo, the full feature corpus lives at `parity/flow-a-corpus/*` (one directory per capability:
animations, responsive-grid, forms, charts, svg, gradients, clip, transforms, multi-page nav, …) — those are
the canonical references for any capability not shown here.
