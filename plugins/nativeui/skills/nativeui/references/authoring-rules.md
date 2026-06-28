# NativeUI authoring rules — the HTML/CSS surface

NativeUI imports/exports **ordinary HTML + CSS** (the same a browser renders). There is no NativeUI markup
language: structure comes from semantic HTML; all layout + appearance from CSS (embedded `<style>` and/or
inline `style`). The importer infers editable native nodes; the exporter writes plain HTML/CSS back.
*(Authoritative source in the repo: `docs/html-format.md`.)*

## Hard constraints (violating these aborts or silently no-ops the import)
- **No `<script>`. No external/CDN `<link rel="stylesheet">`.** Embedded `<style>` + inline `style` only.
  These produce structured import errors.
- **No authored `data-*` attributes** — stripped before import; they cannot drive layout, styling, ids,
  references, interactions, or charts. Use real attributes/elements instead.
- **Colors**: ordinary CSS — 3/4/6/8-digit hex (`#abc`, `#abcd`, `#rrggbb`, `#rrggbbaa`), legacy + modern
  `rgb()/rgba()` (`rgb(124 58 237 / .8)`), `hsl()/hsla()`, named colors, and `linear-gradient()`/`radial-gradient()`.
  (Internally stored as `#rrggbb@alpha`; you don't write that form in HTML.)
- **Stable ids**: every named/interactive element gets an `id`; **start with a letter** (`login_button`, not
  `2fa_button`) — digit-first ids get an unstable native id and **no typed backend accessor** on Android.
  Repeated styling → `class`.

## Document shape (one per screen)
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Home</title>            <!-- becomes the stage/screen name -->
  <style>
    body { position: relative; width: 412px; height: 915px; background: #f0f2f5; margin: 0; }
    #header { display: flex; align-items: center; height: 56px; padding: 0 16px; background: #1e2229; }
    #feed   { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
    .card   { display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 16px; background: #2a2f38; }
  </style>
</head>
<body>
  <header id="header"><h1 id="title">Home</h1></header>
  <main id="feed"><article class="card" id="card_1">…</article></main>
</body>
</html>
```
Mobile-first: design at **412 × 915** first. User-agent margins (`<h1>`–`<h6>`, `<p>`) are honored, so it lays
out like a browser.

## HTML/CSS → native mapping (what each thing becomes)
| Native result | Authored from |
|---|---|
| Stage size / background / name | root/`<body>` `width`/`height`/`background`; `<title>` |
| Container kind | `display:flex` row → HBox, column → VBox, `+flex-wrap:wrap` → FlowPane; `display:grid` → GridPane; all-children `position:absolute` → AnchorPane; `overflow:auto/scroll` → ScrollPane |
| Absolute/anchored layout | `position:absolute` anchors to the nearest `position:relative` ancestor's box; `position:fixed` anchors to the **stage/viewport** (top/bottom/left/right resolve against the stage — use for top bars & bottom tab bars); `position:sticky` stays **in-flow and does NOT pin chrome**. Offsets: `top/left/right/bottom` (px or `%`, e.g. `top:18%`); `inset:0` (or 1–4 values, like margin) fills all four sides; `top:0;height:100%` (or `left:0;width:100%`) stretch-fills the parent. |
| Flex child layout | `flex-grow`/`flex` (a row of `flex-grow:2` + `flex-grow:1` splits free space 2:1 — weights honored, not just `:1`); `flex-shrink:0` / `flex:none` pins a child to its width (carousel cells); `align-items`/`justify-content` incl. spaced modes `space-between`/`space-around`/`space-evenly` (e.g. a bottom bar `justify-content:space-around`); `align-self` (per-child cross-axis); `gap`/`row-gap`/`column-gap`, `margin` |
| Grid | `grid-template-columns` (`repeat(n,…)`, `fr`, fixed px, `minmax(a,b)`, `repeat(auto-fill\|auto-fit, minmax(140px,1fr))`); `grid-auto-rows:<px>` fixes implicit row height; children flow in DOM order; a child spans via `grid-column: span 2` / `1 / 3` / `1 / -1` (full row) and `grid-row: span 2` |
| Sizing | `width`/`height`/`min-*`/`max-*`; `aspect-ratio:16/9` derives height = width÷ratio from the resolved width (media cards / square avatars) — content height is a FLOOR, so the box grows past width/ratio when content needs it but never shrinks below it. Lengths: see *Lengths & units* below. |
| Typography | `font-family`, `font-size`, `font-weight`, `font-style`, `text-align`, `text-decoration`, `line-height`, `letter-spacing` |
| Fills / borders | `color`, `background`/`background-color`, gradients, `border`/`border-*`, `border-radius` |
| Effects | `box-shadow` (inset OK; of a comma-separated list **only the first** shadow imports), `text-shadow` (stacks; renders on all five lanes), `opacity`, **`filter:blur()` renders on all lanes**. Non-blur `filter` functions and `backdrop-filter` are **not** honored on native — see *Not supported / degrades* below for the full breakdown and the `rgba()`-overlay workaround |
| Transforms | `transform: translate()/scale()/rotate()/skew()` |
| Overflow / clip | `overflow:hidden` → clip; `overflow:auto/scroll` → ScrollPane; `clip-path: circle()/polygon()/inset()` |
| Controls | `<button>`→Button, `<input type=text/password>`→TextField/PasswordField (`placeholder`,`value`), `<input type=checkbox>`+`<label>`→CheckBox (`checked`), `<input type=range>`→Slider, `<progress value max>`→ProgressBar, valueless `<progress>`→indeterminate ProgressBar, `<textarea>`→TextArea, `<select>`→ComboBox |
| Images | `<img src>` — **only `data:` base64 URIs embed pixels that render on device** (desktop/iOS/Android); a remote/relative URL renders **BLANK** off-browser (NO fetch at import) → **inline images as base64**. `object-fit` cover/contain/fill. See *Images: object-fit & background-image fill* below |
| Charts / vectors | inline `<svg>` with `path`/`line`/`polyline`/`polygon`/`circle`/`rect`/`text` |
| Text content | element text (`<h1>Title</h1>`, `<button>Save</button>`) |

Supported kinds: Pane, AnchorPane, HBox, VBox, StackPane, BorderPane, GridPane, FlowPane, Group,
ScrollPane, Label, Button, ToggleButton, Hyperlink, TextField, PasswordField, TextArea, CheckBox, ComboBox,
ListView, ProgressBar, Slider, Separator, Chart, Rectangle, Circle, Line, Path, Polygon, Polyline, Text, ImageView.

## Lengths & units
Stage is **412 × 915 px** — author against that. Supported length units, all resolved to px at import:
- `px` and bare numbers (1:1).
- `%` — resolved against the containing block (width %, height %, anchor %). Author `%`/`fr`/`flex-grow` for fluid layouts so the resolver can re-resolve per device width (frozen px do not).
- `rem` = 16px root (`1.5rem`→24px); `pt` = 4⁄3 px (CSS pt).
- `vw`/`vh`/`vmin`/`vmax` — `vw` against stage width, `vh` against 915, `vmin`/`vmax` against the min/max of the two (`50vw`→206px at 412 stage).
- `calc()`, `min()`, `max()`, `clamp()` math over any of the above (`width:calc(100% - 32px)`, `clamp(16px, 4vw, 24px)`).
- **AVOID `em`** — it stays **unresolved** (the importer is context-free and can't know the inherited font-size), so an `em` length is dropped. Use `rem` or `px` instead. *(Exception: `line-height` in `em` IS honored — it resolves against the element's own font-size.)*

Prefer `px`/`%` for hard box sizes; the richer units (`rem`/`vw`/`calc()`…) land at the sites that resolve them (grid tracks, anchors, gaps).

### Grid spans (worked example)
```css
.gallery   { display: grid; grid-template-columns: 120px 1fr; grid-auto-rows: 56px; gap: 10px; }
.gallery .hero { grid-column: 1 / 3; }      /* span both columns (also: grid-column: span 2) */
.gallery .tall { grid-row: span 2; }        /* occupy two rows; following cells skip the reserved block */
.fluid     { display: grid; gap: 12px;
             grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }  /* as many ≥140px cols as fit */
```
`grid-auto-rows:<px>` is needed for spanning rows — without it implicit rows collapse to content height (spanned cells flatten to thin bars). `grid-column: 1 / -1` spans every column. `auto-fit` collapses empty trailing tracks (cards stretch); `auto-fill` keeps them.

## Recipes — common app patterns
Proven HTML/CSS for the blocks every app needs. Each imports as written (verified against the importer + the `parity/flow-a-corpus/*` capability pages).

### Forms
Use real controls, not styled divs. Kind is inferred from the tag/type: `<input type=text|email|tel|number|search>`→TextField, `type=password`→PasswordField, `type=range`→Slider, `type=submit|button|reset`→Button, `type=checkbox`→CheckBox, `type=radio`→RadioButton; `<textarea>`→TextArea (wraps); `<select>`→ComboBox. `placeholder`→prompt text, `value` / textarea body→initial text, `<option selected>`→the selected value, `checked`→on. Pair each field with a `<label>`. Give every field a stable **letter-first** id (`email_field`, never `2fa_field`).
```html
<div class="field"><label>Email</label><input id="email_field" type="email" placeholder="you@app.com" value=""></div>
<div class="field"><label>Plan</label><select id="plan_select"><option>Free</option><option selected>Pro</option></select></div>
<div class="field"><label>Notes</label><textarea id="notes_field">Default text</textarea></div>
<button id="submit_btn" class="submit">Create account</button>
```
**Radio groups**: radios with the same `name` are mutually exclusive; a row of un-named radios under one parent is also treated as one group, so `name` is optional when they share a wrapper.
```html
<div class="radio"><input type="radio" name="pay" checked> Card</div>
<div class="radio"><input type="radio" name="pay"> PayPal</div>
```
**Checkbox + label** (CheckBox), put the box first then the text:
```html
<label class="check-row"><input type="checkbox" checked> Email me receipts</label>
```

### Data tables
`<table>/<thead>/<tbody>/<tfoot>` each import as a **VBox**, `<tr>` as an **HBox** — so a table is just stacked rows. Make it fill the width and align numeric columns; do zebra/total styling with a **class** (`:nth-child` is NOT supported).
```html
<style>
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  thead th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e6e8ee; }
  tbody td { padding: 10px; border-bottom: 1px solid #eef0f4; }
  td.num { text-align: right; font-weight: 600; }            /* right-align numbers via class */
  .zebra { background: #f7f8fa; }                            /* zebra via class, not :nth-child */
  .total-row td { border-top: 2px solid #e6e8ee; font-weight: 800; }
</style>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
  <tbody>
    <tr><td>Aero Runner</td><td class="num">1</td><td class="num">$129.00</td></tr>
    <tr class="zebra"><td>Trail Cap</td><td class="num">2</td><td class="num">$56.00</td></tr>
    <tr class="total-row"><td>Total</td><td class="num"></td><td class="num">$203.00</td></tr>
  </tbody>
</table>
```

### Lists
`<ul>/<ol>`→VBox; `<li>` with only text→a row Label, with child elements→an HBox. `list-style: disc`/`decimal` draws bullets/numbers; set `padding-left` for the marker gutter. For a settings/menu list, drop the bullets and build rows of leading-icon + `flex:1` label + trailing value:
```html
<style>
  ul { list-style: disc; padding-left: 22px; display: flex; flex-direction: column; gap: 6px; }
  .item { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid #eef0f4; }
  .ico { width: 28px; height: 28px; border-radius: 8px; background: #eef3ff; flex: none; }
  .item-label { flex: 1; }              /* label takes the slack, value pins right */
  .item-val { color: #6b7280; }
</style>
<div class="item"><div class="ico"></div><div class="item-label">Notifications</div><div class="item-val">On</div></div>
```

### Data-backed lists / repeaters
Plain HTML import creates **concrete rows**. For a true product repeater, mark the imported container in the
project/editor model: its `children` become the item template, `repeater.sampleItems` provide native/web preview
rows, and placeholders like `{{item.title}}` / `{{$index}}` are expanded during export. Do **not** use `data-*`
attributes; they are stripped. If the repeater should later load real API/database data, register the source as
an `api` or `database` library item and wire the live behavior in matching Android + iOS connectors.

### Scrolling — carousels & scroll regions
Any `overflow:auto/scroll` (or `overflow-x`/`overflow-y`) container becomes a **ScrollPane**.
**Horizontal carousel** — a flex row that overflows, with fixed-width children that refuse to shrink:
```html
<style>
  #carousel { display: flex; flex-direction: row; gap: 12px; flex-wrap: nowrap; overflow-x: auto; }
  .slide { width: 150px; height: 100px; flex-shrink: 0; border-radius: 12px; }   /* flex-shrink:0 keeps each card its full width */
</style>
<div id="carousel"><div class="slide">…</div><div class="slide">…</div><div class="slide">…</div></div>
```
**Pinned header + scrolling body** — make the header (and any bottom bar) `position:absolute`, and a sibling body `position:absolute` between them with `overflow-y:auto`. (`position:sticky` does NOT pin chrome — use absolute.)
```html
<style>
  #header { position: absolute; top: 0; left: 0; right: 0; height: 132px; z-index: 10; }
  #body   { position: absolute; top: 132px; bottom: 76px; left: 0; right: 0; overflow-y: auto; }
  #tabbar { position: absolute; bottom: 0; left: 0; right: 0; height: 76px; z-index: 10; }
</style>
```

### Navigation chrome — tab bars & bottom nav
A bottom/segmented bar is a `position:absolute` (or `fixed`) flex-row whose items each take `flex-grow:1` so they split the width evenly; mark the current one with an active class. Stack icon + label per item. Wrap each item in `<a href="#ScreenName">` to make it navigate — an `<a>` that wraps child elements stays a container (HBox/VBox) AND carries the nav, while a text-only `<a>` becomes a Hyperlink. The href targets the destination **screen's title/name slug** (`<title>Activity</title>` → `href="#activity"`) or a 1-based page index (`#page2`/`#2`), never an element id.
```html
<style>
  #bottomnav { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; flex-direction: row; border-top: 1px solid #e5e7eb; }
  .nav { flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
  .nav.active .navlbl { color: #4f46e5; font-weight: 600; }
</style>
<div id="bottomnav">
  <a href="#home" class="nav active"><div class="navico"></div><div class="navlbl">Home</div></a>
  <a href="#activity" class="nav"><div class="navico"></div><div class="navlbl">Activity</div></a>
</div>
```
*Segmented control* is the same idea inside a rounded pill (`#tabs{display:flex;background:#f3f4f6;border-radius:10px;padding:4px}` with `.tab{flex-grow:1}` and an active tab that gets a white background).

### Charts from primitives (no canvas, no chart-JS)
Draw charts as ordinary flex/SVG. NativeUI imports the visible marks directly so editor and native render the same geometry.
**Bar chart** — a `align-items:flex-end` flex row of bars whose `height` is a `%`:
```html
<style>
  #chart { display: flex; flex-direction: row; align-items: flex-end; gap: 10px; height: 140px; }
  .bar { flex-grow: 1; background: #6366f1; border-radius: 6px 6px 0 0; }
</style>
<div id="chart"><div class="bar" style="height:40%"></div><div class="bar" style="height:70%"></div><div class="bar" style="height:90%"></div></div>
```
**Line / area chart** — inline `<svg>`: a `<polyline>` (or `<path>`) for the line with `fill="none"`, a closed `<path>` for the area fill, optional `<circle>` point markers:
```html
<svg width="100%" height="168" viewBox="0 0 348 168">
  <path d="M24 128 L124 100 L224 72 L324 40 L324 128 L24 128 Z" fill="#eaf1ff"/>
  <polyline points="24,128 124,100 224,72 324,40" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="324" cy="40" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"/>
</svg>
```
**Donut / ring** — a stroked `<circle>` with `fill="none"`; draw the progress arc with `stroke-dasharray` (= `arc-length gap-length`, rotate the start with `transform:rotate(-90deg)`). Note: `stroke-dashoffset` is NOT imported, so size the arc with `stroke-dasharray` alone (`dasharray = "<arc> <circumference-minus-arc>"`).
```html
<svg width="120" height="120" viewBox="0 0 120 120">
  <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" stroke-width="12"/>
  <circle cx="60" cy="60" r="52" fill="none" stroke="#6366f1" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="245 327" transform="rotate(-90 60 60)"/>   <!-- ~75% ring; 2πr≈327 -->
</svg>
```

### CSS toggle / switch
NativeUI recognizes the standard switch idiom and renders it as a pill + sliding thumb on every lane: a container holding a **visually-hidden** `<input type=checkbox>` (`opacity:0` / `display:none` / 0×0) plus a sibling `.track` that has a pill `border-radius` and an `::after` thumb. The on-state goes on a `:checked + .track` rule; add `checked` to the input for the default-on state.
```html
<style>
  .switch { position: relative; width: 52px; height: 30px; }
  .switch input { opacity: 0; width: 0; height: 0; }                 /* hidden checkbox */
  .track { position: absolute; inset: 0; background: #cdd3dd; border-radius: 15px; }   /* pill */
  .track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; }   /* thumb */
  .switch input:checked + .track { background: #2f6bff; }
  .switch input:checked + .track::after { left: 25px; }              /* thumb slides on */
</style>
<label class="switch"><input type="checkbox" checked><span class="track"></span></label>
```

## Gradients
**`linear-gradient(...)`** and **`radial-gradient(...)`** both import as real native gradient paints (editor, web, iOS, Android). `conic-gradient()` is still **NOT supported** (it falls back to no fill — author a `linear-gradient`/`radial-gradient` or a flat color instead). All of these `linear-gradient` features work on every lane:
- **Angle**: `Ndeg` (`135deg`), `Nturn` (`.5turn`), or a side keyword `to top|right|bottom|left`. A bare-color first arg defaults to `180deg` (top→bottom).
- **Multi-stop + hard-stops**: `linear-gradient(90deg, #06b6d4 0%, #3b82f6 50%, #111 50%)` — repeating an offset makes a hard color band.
- **Stop units**: `%`, `px`, `em`/`rem` (16px), `vh`/`vw` — all resolved to a [0,1] fraction; position-less stops distribute evenly. Prefer `%`.
- **Stacked layers**: comma-separate background layers (top layer first), e.g. `background: linear-gradient(180deg,#0000,#000a), linear-gradient(135deg,#7c3aed,#ec4899);` — each layer imports; mix gradient + flat color layers freely.

```css
#hero { background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); }
```

**`radial-gradient(...)`** imports too — center (`at X% Y%`), radius/extent, and color stops resolve, and the
natives emit a real radial paint (iOS radial `CAGradientLayer`, Android radial `GradientDrawable`). Use it for
glows and spotlights:
```css
#glow { background: radial-gradient(circle at 50% 40%, #7c3aed 0%, #1e1b4b 70%); }
```

## Gradient text (`background-clip:text`)
Fill glyphs with a gradient via the standard idiom: a `linear-gradient` `background` + `-webkit-background-clip:text` + `-webkit-text-fill-color:transparent`. **Also set a flat `color`** as the fallback — the desktop editor renders the solid `color` (no gradient-text fill there) while the web/native lanes fill the glyphs, so the flat color keeps it readable everywhere.
```css
#brand { color:#7c3aed; background:linear-gradient(90deg,#7c3aed,#ec4899);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
```

## SVG icons & vector paint
Inline `<svg>` is the icon path (no icon font). Standard 24-grid idiom:
```html
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M5 12 L10 17 L20 6"/></svg>
```
- **Display size ≠ viewBox**: `width`/`height` set the on-screen box; `viewBox` is the internal coordinate grid (icon scales to fit). 24×24 grid is the norm; render at any size.
- **Solid icons** set `fill="#color"` (default SVG fill is **black** if omitted). **Line icons** set `fill="none"` + `stroke="#color"` + `stroke-width` (default stroke = none, default stroke-width = 1).
- **`currentColor`** on `fill`/`stroke` inherits the CSS `color` of the element (or an ancestor) — set the icon color once via `color:` and reuse the same SVG.
- `fill`/`stroke` resolve through the full cascade (presentation attr, inline `style`, matched class rule) and inherit from a wrapping `<svg>`/`<g>`.

**SVG gradient fill/stroke**: define `<linearGradient id="g">` (or `<radialGradient id="g">` — `cx`/`cy`/`r` resolve, default 50%) inside `<defs>`, reference with `fill="url(#g)"` and/or `stroke="url(#g)"` on the same shape — both resolve.
```html
<svg width="72" height="72" viewBox="0 0 72 72">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs>
  <circle cx="36" cy="36" r="28" fill="none" stroke="url(#g1)" stroke-width="8"/></svg>
```

## Fonts
Never `@import` or `<link>` a font stylesheet (external stylesheets abort the import). Just name the family in `font-family`; the pipeline provides the bytes:
- **Inter** is the default + the fallback for any unknown family and for the generic tokens `sans-serif` / `system-ui` / blank — all collapse to Inter deterministically (editor == webapp == native).
- **Inter, Poppins, Lato** are bundled (zero setup, instant).
- **Any other Google Fonts family** (e.g. `Roboto`, `Montserrat`) is **auto-fetched and cached at import** (decoded to TTF under `~/.nativeui/fonts/cache`); a second import is an offline cache hit. A family Google doesn't serve falls back to Inter.
- Mix families per element/`<span>` freely — `<span style="font-family:'Poppins'">A</span><span style="font-family:'Lato'">B</span>`.

**Numeric `font-weight` 100–900** is honored. **Inter** ships real intermediate cuts (300 Light, 500 Medium, 600 SemiBold) so those render the true weighted glyph; **Poppins/Lato ship only Regular+Bold**, so their in-between weights snap (`<700`→Regular, `≥700`→Bold). Auto-fetched families likewise have Regular+Bold cuts (intermediates snap). For a precise weight ladder, use Inter.

## Images: `object-fit` & background-image fill
Give an `<img>` an explicit `width` **and** `height`, then choose how the pixels fill that box with `object-fit`:
- `cover` — scale to fill + crop overflow (photos, avatars).
- `contain` — fit whole image, letterboxed (logos).
- `fill` — stretch to the box (ignores aspect).
- No `object-fit` (or no box) → natural pixel size.

**`object-position`** controls which part of a `cover`/`contain` image stays visible — `object-position: 50% 20%`
(or `top`/`center`/`right`…) shifts the crop. It resolves on every lane (iOS crops via `layer.contentsRect`,
Android via the matching `scaleType`), so an off-center avatar/hero crop is faithful on device.

Images render on device **only from `data:` base64 URIs** (a remote/relative URL renders blank off-browser — see the Images mapping row).

**Circular avatar** one-liner — square box + `object-fit:cover` + 50% radius:
```html
<img src="data:image/png;base64,…" style="width:56px;height:56px;border-radius:50%;object-fit:cover">
```
**Photo background**: a container with `background-image:url('data:…')` paints a raster behind its children — pair with `border-radius` + `overflow:hidden` for hero headers / photo cards. **`background-size`** (`cover`/`contain`/`Npx`/`%`) and **`background-position`** are honored on every lane (no longer hard-pinned to `cover`/`center`), so a `contain` logo or a `background-position: top` crop is faithful on device. `data:` only (a plain URL renders blank off-browser).

## Not supported / degrades (author around these)
These CSS features are silently ignored or only partially honored. The importer does NOT error on them — it drops them — so a browser mockup can look right while the imported app differs. Author around them.

**Silently ignored (no native effect at all):**
- **`conic-gradient()`** — not imported (only `linear-gradient()`/`radial-gradient()` are). A conic background drops to no fill (or the shorthand's fallback color). Fake a sweep with a `radial-gradient` or an inline `<svg>`.
- **`text-transform: lowercase | capitalize`** — only `uppercase` is applied. `lowercase`/`capitalize` are no-ops → author the final casing into the text itself.
- **`text-align: justify`** — falls back to the default (LEFT). Use `left`/`center`/`right`/`start`/`end` only.
- **`dir="rtl"` / logical `start`/`end` flipping** — no RTL handling; DOM order is NOT mirrored and `start`/`end` do not flip. Author LTR with explicit `left`/`right` and physical order.
- **`em` for sizing/spacing** (`width`/`padding`/`gap`/`margin`/`font-size`…) — left unresolved (the context-free parser has no inherited font-size), so the value is dropped. Use `px`, `rem` (16px root), `%`, `vw`/`vh`, or `calc()/min()/max()/clamp()`. *(Exception: `line-height` in `em` IS honored — it resolves against the element's own font-size.)*
- **`@import` in a `<style>` block** — dropped (body-less at-rule). Combined with the no-external-`<link>` hard constraint, you cannot pull in a font sheet this way. Don't load fonts via `@import`/`<link>` — just name a Google family in `font-family` (it is auto-fetched at import) or use a bundled family (Inter/Poppins/Lato).

**`display:none` DROPS the node from the tree** (not just at a breakpoint — anywhere). So you cannot author a hidden node and reveal it later: it's gone at import. For a node the backend shows/hides at RUNTIME (empty states, conditional rows, error banners), author it **visible** and have `NuiBackend` hide it on screen-ready via the typed accessor (`controls.errorBanner.isHidden = true`). Same for "row pool" patterns — author all rows visible; the backend fills + hides the unused ones.

**Identical wired-control content across screens COLLAPSES into one shared component** — losing the per-screen accessor. The importer factors duplicate content (e.g. two screens each with an `<input placeholder="Email">`) into a single "Reusable Component", so only one of the two ids gets a typed accessor; the other appears "dropped". Give every backend-wired control content that **differs across screens** (distinct placeholder/label/text) AND a per-screen-prefixed id (`login_email` / `register_email`), so each stays a distinct, accessible control. This only bites at full multi-screen scale (a 2-screen test won't show it).

**`animation-delay`** — dropped. In the `animation` shorthand only the FIRST time token is read (as the duration); a second time token (the delay) and a standalone `animation-delay` longhand are ignored. Bake any stagger into the keyframe offsets instead, e.g. `@keyframes in{0%,20%{opacity:0}100%{opacity:1}}` to hold for the first 20% of the duration.

**Per-corner `border-radius`** — only the **shorthand** is read: `border-radius: 4px 16px 4px 16px;` (= TL TR BR BL). The CSS **longhands** `border-top-left-radius` / `border-bottom-right-radius` etc. are NOT parsed and are ignored. Always express asymmetric corners via the shorthand. See the lane caveat below for native rendering.

**Remote / relative `<img src>` and `url()` images render BLANK on device** — there is NO image fetch at import. Only an inline `data:` base64 URI embeds pixels that render on every lane (desktop, web, iOS, Android). A plain `http(s)`/relative URL is kept verbatim and shows nothing on any non-browser lane. Inline images as base64; reserve plain URLs for browser-only mockups.

**Non-blur `filter()` + `backdrop-filter` — only `filter: blur()` renders.** The importer captures the whole `filter`/`backdrop-filter` string verbatim, but every renderer except the live web preview extracts ONLY `blur(Npx)`:
- `filter: blur(6px)` renders on **all four lanes** (desktop editor GaussianBlur, web, iOS live `.blur`, Android `RenderEffect`). Use it freely.
- `filter: brightness/contrast/saturate/grayscale/sepia/hue-rotate/invert(...)` — **web preview only**; the desktop editor, iOS, and Android all drop it. To dim/tint, paint an explicit `rgba()` overlay box instead.
- `backdrop-filter` (frosted glass) — **web preview only**; desktop editor, iOS, and Android do not render it. For a glass panel, use a semi-opaque `rgba()` background (optionally over a `filter:blur()` sibling).

### Lane-divergent rendering (looks different in editor vs web vs device)
These DO import, but a given lane degrades them — so verify on the target device, don't trust the web preview alone.

- **Gradient text (`background-clip:text`)** — `background:linear-gradient(...)` + `-webkit-background-clip:text` + `-webkit-text-fill-color:transparent` fills the GLYPHS with the gradient on the **web preview** and on **iOS/Android** (the natives paint the gradient behind the live label text). The **desktop editor** has no gradient-text-fill and renders the glyphs in a **solid color** instead. So ALWAYS set a plain `color:` as the flat fallback — that color is what the desktop editor shows, and it's the safe baseline. *(The box itself stays transparent — the gradient never paints a background rectangle.)*
- **Per-corner (non-uniform) `border-radius`** — the shorthand `border-radius:4px 16px 4px 16px` keeps all four radii on the **web preview, desktop editor, and iOS** (iOS carries true per-corner radii). **Android collapses it to a UNIFORM radius equal to the top-left corner** (its shape drawable only supports one `<corners android:radius>`). So a tag with two rounded and two square corners looks asymmetric everywhere except Android, where all four corners match the top-left. Prefer a uniform `border-radius` when cross-platform corner fidelity matters.

## Responsiveness — `@media` width breakpoints (→ smart divisions)
Author mobile-first, then add `@media` rules that change layout at wider widths. NativeUI captures these as
**smart divisions** that re-resolve per device width — on the editor, the web preview, AND on device.
```css
/* mobile-first: one column */
#grid { display: flex; flex-direction: column; gap: 12px; }
.cell { width: 100%; }
/* tablet+: multi-column */
@media (min-width: 600px) { #grid { flex-direction: row; flex-wrap: wrap; } .cell { width: 50%; } }
@media (min-width: 900px) { .cell { width: 33.33%; } }
```
Width conditions also accept Media-Queries-L4 **range syntax** — `(max-width:600px)`, `(min-width:600px)`, `(width < 768px)`, `(768px >= width)`, `(360px <= width < 768px)` — all mined as breakpoints. At a breakpoint you may override **any** property (widths, `flex-direction`, `grid-template-columns`, `display:none` to drop a node, …). **On device the resolver re-runs at the real width**: `%` widths re-resolve against the parent, `flex-grow` redistributes free space, and single-line text re-wraps — so author `%`/`fr`/`flex-grow`, not frozen px, or the layout won't adapt. (A node that a breakpoint adds/removes from the tree is a *structural* change overrides can't express — that subtree is captured at base only.) Common patterns: narrow → stack columns + shrink hero + hide a sidebar; wide → 2–3 column grid.

## Animations — `@keyframes` + `animation` (→ the timeline, runs on device)
```css
@keyframes slideIn { 0% { left: 0; opacity: 0; } 100% { left: 40px; opacity: 1; } }
@keyframes pulse   { 0% { opacity: .4; } 50% { opacity: 1; } 100% { opacity: .4; } }
#hero  { position: relative; animation: slideIn 3s ease-in-out infinite; }
#dot   { animation: pulse 1.5s linear infinite; }
```
Notes that match NativeUI's runtime exactly:
- A `position:relative` element animating `left`/`top` becomes a **translate** (moves without disturbing
  layout) — the on-device runtime + every lane honor it.
- `transform: translate/scale/rotate`, `opacity`, `background-color`, `width`/`height` all animate.
- `infinite`, `alternate` (ping-pong), `reverse`, multi-stop keyframes, per-keyframe easing all supported.
- **State/event animations**: author on `:hover` / `:active` (e.g. `#cta:hover { animation: glow .4s; }`,
  `.row:active { animation: pressPop .12s; }`).

**Per-state animations do NOT auto-fire on device.** The on-device animation runtime auto-plays only the BASE (on-load) `@keyframes` timeline. Animations attached to `:hover`/`:active`/`:focus`/`:checked`/`:disabled` import and are editable, but are NOT auto-triggered on the exported app — drive them from `NuiBackend` (e.g. a control listener that plays the state's timeline). So: rely on a base on-load animation for motion that must run on device; treat per-state animations as authoring/preview-only unless you wire them in the backend.

## Events
Author interactions on the elements (e.g. a `<button id="save_btn">`, an `<a href="#detail">` link). Authored
events surface to the backend via the contract (`onCallApi`, `onNavigateToStage`, …) — don't fake behavior
with `<script>`. Navigation between screens: `<a href="#screen-slug">` (destination title/name slug or 1-based
page index — see SKILL.md golden rule #6).

### Events (what import captures)
The importer records the native event surface as interactions: `<a href>` (navigate/open-url), `<form>` (submit), and any `on*` attribute. `on*` JS bodies are NOT executed — they are stored opaque and you implement the behavior in connector classes. Full trigger/action vocabulary, the zero-code-vs-backend split, and the `on*`→trigger map live in `references/backend-contract.md`. Author behavior in `*BackendConnector.*`, not inline JS.

## Multi-page apps
One complete HTML document per screen. Link screens with `<a href="#other-screen-id">`. Repeated structures
(navs, footers, cards) across pages are auto-promoted to internal library components; keep them identical so
they reconcile.

## Charts / vectors
Inline `<svg>` only (no canvas, no chart JS). Geometry attrs (`d`, `points`, `x1/y1/x2/y2`, `cx/cy/r`, `fill`,
`stroke`, `stroke-width`) are read directly. `fill="none"`/`stroke="none"` → transparent.
