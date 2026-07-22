# NativeUI project model + toolchain

A NativeUI project is a single JSON document (`ProjectState`). You usually **generate** it by importing
HTML/CSS (`nui-import.mjs`) — that is the source of truth and the round-trip-safe path. But once it exists
you can make **confident, targeted hand-edits** to `project.json` (change a color, a label, a position; add /
remove / reorder a node) because the model **round-trips as a strict fixpoint** (see
"Why hand-edits are safe" below). This file documents the schema truthfully — field names are exact, read
from the Java model + a real serialized `project.json` — so you can edit with precision.

> **Golden invariant — JSON keys == Java field names.** There are **no** `@SerializedName` renames anywhere
> in the model: every field below appears in `project.json` under exactly the name shown. The serializer is
> plain Gson. So you edit the field by its documented name and it round-trips.

---

## 1. Top-level shape — `ProjectState`

A real serialized project's top-level keys are exactly `version`, `stages`, `libraryItems`, `webFonts`:

```jsonc
{
  "version": 4,                     // schema version. CURRENT = 4. Don't change it by hand.
  "stages": [ /* StageState[] */ ], // one per screen
  "libraryItems": [ /* LibraryItemState[] */ ],  // promoted colors/fonts/components/api/db (see §6)
  "webFonts": [ "Inter", "Roboto" ] // non-bundled Google font families used (strings)
}
```

| field | type | notes |
|---|---|---|
| `version` | `int` | **Current = 4.** Min supported = 1; the editor warns if `version > 4`. Set by the importer; never bump by hand. |
| `stages` | `StageState[]` | the screens, in order (page 1 = index 0). |
| `libraryItems` | `LibraryItemState[]` | reusable refs promoted on import (§6). May be absent/empty. |
| `webFonts` | `String[]` | non-bundled Google Font family names that travel with the project. May be absent. |

(`projectName` and a few editor-only fields can appear when saved from the desktop/web editor; they are
optional and ignored on export. Undo/redo history is always stripped before save.)

---

## 2. `StageState` — one screen

```jsonc
{
  "name": "Home",                   // stage label; ALSO the nav slug target ("Trip Detail" -> #trip-detail)
  "stageId": "stage-1",             // STABLE navigation target id (interactions point here, NOT at name)
  "backgroundColor": "#ffffff@1.000", // storage color (see §8)
  // stageWidth/stageHeight are intentionally omitted: importer/editor snapshots may add them, but authors
  // must not seed product layout from a copied preview size.
  "rootNodes": [ /* NodeState[] */ ],   // top-level node(s) of this screen — usually ONE body root
  "interactions": [ /* InteractionState[] */ ],   // stage-level events (e.g. ON_LOAD -> CALL_API)
  "divisions": [ /* DivisionState[] */ ],          // responsive @media breakpoints (optional)
  "responsiveLayoutVersion": 1,     // 1 = typed responsive metadata is present; absence never makes resolved px authoritative
  "timeline": { /* animation snapshot */ }         // optional; @keyframes -> timeline (see §7)
}
```

| field | type | notes |
|---|---|---|
| `name` | `String` | screen title. Nav `href="#..."` resolves by this name's slug (or 1-based page index). |
| `stageId` | `String` | stable id targeted by `NAVIGATE_TO_STAGE` interactions. Independent of `name`. |
| `backgroundColor` | `String` | storage color `#rrggbb@alpha`. |
| `stageWidth` / `stageHeight` | `Double` | captured editor/parity snapshot dimensions in px. They describe the deterministic snapshot used for import/editor rendering, not an authoring default or fixed product shell. |
| `rootNodes` | `NodeState[]` | the node tree. **This is what you edit for a screen.** |
| `interactions` | `InteractionState[]` | stage-scoped events. Optional. |
| `divisions` | `DivisionState[]` | optional smart-division patches for discrete structural changes. Absent/empty means there are no breakpoint patches; the layout may still be intrinsically responsive through flex/grid sizing and semantic parent constraints. |
| `responsiveLayoutVersion` | `Integer` | `1` when typed responsive metadata is present. Leave as imported. A missing legacy marker does not authorize captured/resolved px as product geometry; re-author layout intent when it is absent. |
| `timeline` | object | animation keyframes (§7). Optional. |

---

## 3. `NodeState` — the universal node

Every visible thing is a `NodeState`. Children nest via `children`. The same struct carries layout, transform,
visual, text, and control fields; most are at defaults for any given node (Gson writes primitives even at
default, so expect many `0.0` / `-1.0` / `false` fields you can ignore). **Edit the field that matters; leave
the rest.**

### 3.1 Identity
| field | type | default | meaning |
|---|---|---|---|
| `kind` | `String` | — | fully-qualified JavaFX class name (see §4 for valid values). Determines what it renders as. |
| `id` | `String` | — | designer/CSS id → becomes the native typed control accessor. **Must be letter-first** (`login_button`, never `1btn`). Keep unique within the project. |
| `style` | `String` | — | raw inline CSS string (rarely hand-edited; prefer the typed fields). |
| `nodeRefId` | `String` | — | synthetic index used by timeline/interactions. Don't invent one. |

### 3.2 Layout / geometry (all `double` unless noted)
| field | default | meaning |
|---|---|---|
| `layoutX` / `layoutY` | `0` | position within the parent (px). **Only honored when the node is unmanaged / anchored** — managed flex children ignore baked `layoutX/Y` (JavaFX re-lays them out). For absolutely positioned nodes (in an `AnchorPane`/`Pane`), edit these to move it. |
| `width` / `height` | `0` | resolved box snapshot (px). Treat it as read-only evidence for managed layout, not an authoring constraint or exported product size. |
| `prefWidth` / `prefHeight` | `-1` (`USE_COMPUTED_SIZE`) | preferred size. Keep `-1` (auto/parent-owned) for ordinary layout. Set an explicit value only for intentionally intrinsic component geometry or a true overlay whose paired parent anchors define its placement; never freeze a page root or major region here. |
| `minWidth` / `minHeight` | `-1` | minimum size. |
| `maxWidth` / `maxHeight` | `-1` | maximum size. |
| `paddingTop`/`Right`/`Bottom`/`Left` | `null`/`0` | inner padding (px), `Double`. |
| `boundsParentMinX`/`MinY`/`Width`/`Height` | — | captured parent-space bounds (`Double`); informational. |

### 3.3 Transform
| field | type | default | meaning |
|---|---|---|---|
| `rotate` | `double` | `0` | rotation in degrees about the pivot. |
| `scaleX` / `scaleY` | `double` | `1` | scale factors. |
| `pivotX` / `pivotY` | `Double` | — | transform pivot; `pivotAutoCenter` (`Boolean`) centers it. |
| `transforms` | `TransformState[]` | — | ordered affine ops; each `{kind, a,b,c,d,e,f}` where `kind ∈ translate|rotate|scale|shear|affine`. |
| `opacity` | `double` | `1` | 0–1. |
| `blendMode` | `String` | — | JavaFX `BlendMode` name (e.g. `MULTIPLY`). |

### 3.4 Visual — background / border / shadow
| field | type | meaning |
|---|---|---|
| `backgroundFill` | `String` | storage color/gradient (§8). The node's fill. |
| `backgroundFillLibraryItemId` | `String` | resolves the fill from a `libraryItems` color/fill ref. |
| `backgroundCornerRadius` | `Double` | uniform corner radius (px). |
| `backgroundCornerRadii` | `String` | per-corner `"tl tr br bl"` px (non-uniform). |
| `backgroundInsetTop`/`Right`/`Bottom`/`Left` | `Double` | inset the fill from the edge. |
| `backgroundImageUrl` / `backgroundImageBase64` | `String` | background image (url or base64). |
| `borderStrokePaint` | `String` | single-border color (§8). |
| `borderStrokeWidth` | `Double` | single-border width (px). |
| `borderCornerRadius` / `borderCornerRadii` | `Double` / `String` | border radius (uniform / per-corner). |
| `borderStrokes` | `BorderStrokeState[]` | multi/concentric borders; each `{paint, width, style(solid\|dashed\|dotted\|none), cornerRadius, inset}`. `null` when a single `borderStroke*` suffices. |
| `boxShadow` | `String` | `"[inset ]offsetX offsetY blur spread #rrggbb@a.aaa"`. |
| `borderSlot` | `String` | which `BorderPane` slot this child fills (top/bottom/left/right/center). |

### 3.5 Shape-specific (Rectangle/Circle/Ellipse/Line/Path/Polygon/Polyline/Text)
| field | type | meaning |
|---|---|---|
| `fill` / `fillLibraryItemId` | `String` | shape fill (color/gradient or lib ref). |
| `stroke` / `strokeWidth` | `String` / `double` | shape outline color + width. |
| `fillRule` | `String` | `nonzero` \| `evenodd`. |
| `pathData` | `String` | SVG path `d` (for `Path`). |
| `centerX`/`centerY`/`radius`/`radiusX`/`radiusY` | `double` | circle/ellipse geometry. |
| `startX`/`startY`/`endX`/`endY` | `double` | line endpoints. |
| `points` | `Double[]` | polygon/polyline vertex list. |

### 3.6 Text
| field | type | meaning |
|---|---|---|
| `text` | `String` | **the text content. Safe, common direct-edit.** |
| `textFill` / `textFillLibraryItemId` | `String` | text color (or lib ref). |
| `promptText` | `String` | placeholder for inputs. |
| `fontFamily` / `fontName` | `String` | font family / resolved face. |
| `fontLibraryItemId` | `String` | resolves the font from a `libraryItems` font ref. |
| `fontSize` | `double` | px. |
| `fontStyle` | `String` | e.g. `Italic`. |
| `fontWeight` | `String` | `NORMAL`/`BOLD`. |
| `fontWeightNumeric` | `Integer` | 100–900 (maps to real Inter Light/Medium/SemiBold/etc.). |
| `textAlignment` | `String` | `LEFT`/`CENTER`/`RIGHT`/`JUSTIFY`. |
| `wrapText` | `boolean` | wrap multi-line. |
| `wrappingWidth` | `double` | wrap width (px). |
| `lineSpacing` | `double` | extra px between lines. |
| `underline` / `strikethrough` | `boolean` | decorations. |
| `textX`/`textY`/`textOrigin`/`textAlignment`/`textBoundsType` | — | low-level text placement (don't hand-edit). |
| `textGlyphPathSvg`, `textBaselineFromTopPx`, `textAdvanceWidthPx`, `textCharAdvancesPx`, … | — | **deterministic glyph-capture metrics. Do NOT hand-edit.** If you change `text`/`fontSize`/`fontFamily`, these go stale — **re-import** instead of editing text geometry by hand. |

### 3.7 Image (ImageView)
| field | type | meaning |
|---|---|---|
| `imageUrl` | `String` | image source url. |
| `imageDataBase64` | `String` | inlined base64 PNG. |
| `imageObjectFit` | `String` | `cover`/`contain`/`fill`. |
| `preserveRatio` / `smooth` | `Boolean` | aspect + smoothing. |

### 3.8 Graphic (Labeled.graphic — an icon inside a control)
`graphicNode` (`NodeState`), `graphicFitWidth`/`graphicFitHeight`/`graphicTextGap` (`Double`),
`graphicSourceNodeId` / `graphicSourceLibraryItemId` (`String`).

### 3.9 Control-specific
| control | fields |
|---|---|
| ScrollPane | `scrollPaneFitToWidth`, `scrollPaneFitToHeight`, `scrollPanePannable` (`Boolean`) |
| ProgressBar/Indicator | `progress` (`Double` 0–1), `progressIndeterminate` (`Boolean`), `progressCornerRadius`, `progressFillColor`, `progressTrackColor` |
| Slider | `sliderMin`, `sliderMax`, `sliderValue` (`Double`) |
| Toggle/CheckBox/RadioButton | `selected` (`Boolean`) |
| ComboBox/ListView | `items` (`String[]`) |
| TableView/TreeTableView | `columns` (`String[]`), `tableColumnWidthsPx` (`Double[]`) |
| TabPane | `selectedTabIndex` (`Integer`) |
| Accessibility | Typed `accessibility` fields: `label`, `help`, `role`, `roleDescription`, `hidden`, `checked`, `selected`, `disabled`; legacy fallbacks: `accessibleText`, `accessibleHelp`, `accessibleRole`, `accessibleRoleDescription`, `accessibilityExcluded`. Supported `alt`, `aria-label`, resolved `aria-labelledby`, portable `role`, role description/help, and ARIA state import into this contract. Author semantics in HTML; use manifest-declared seams only for runtime-derived labels. |

### 3.10 Library / component references
`libraryItemId` (`String`), `libraryReference` (`Boolean` — when `true`, this node is a thin shell that resolves
its subtree from `libraryItems[id]` on load/export; **don't gut a `libraryReference` shell by hand**),
`clipNode` (`NodeState`), `clipSourceLibraryItemId` (`String`). Publishable-component instances also carry
`parameterValues` (`Map<String,String>`) and `eventBindings` (`Map`).

### 3.11 Children & per-state / per-division overrides
| field | type | meaning |
|---|---|---|
| `children` | `NodeState[]` | child nodes. **Add / remove / reorder here to restructure a screen.** |
| `enumProps` | `Map<String,String>` | JavaFX enum properties encoded `"<FQEnumClass>#<ENUM_NAME>"`, e.g. `alignment → javafx.geometry.Pos#CENTER`. Edit the value, keep the `Class#NAME` shape. |
| `nodeRefProps` | `Map<String,String>` | property → another node's ref id. |
| `parentLayoutProps` | `Map<String,String>` | layout intent the parent needs (§5). |
| `stateOverrides` | `Map<String,NodeState>` | state name (`hover`/`pressed`/`checked`/`disabled`/…) → **sparse** NodeState of ONLY the differing fields. |
| `divisionOverrides` | `Map<String,Map<String,String>>` | `divisionId` → (field name → Gson-encoded value) for responsive breakpoints. |
| `interactions` | `InteractionState[]` | node-scoped events (taps, etc.). |
| `repeater` | `RepeaterState` | model/editor-backed data-list metadata: this node's `children` are the item template. |
| `resolved` | object | render-time captured parity metrics — **never hand-edit; ignore.** |

---

### 3.12 Repeater regions (`RepeaterState`)

Repeaters are **model-first**: plain HTML import creates concrete rows, then the editor/agent may mark a
container as a repeated item region. The exporter expands the template into concrete preview rows before each
native/web renderer runs.

```jsonc
{
  "id": "results_list",
  "kind": "javafx.scene.layout.VBox",
  "repeater": {
    "enabled": true,
    "dataSource": "api.results",
    "itemName": "item",
    "previewCount": 3,
    "sampleItems": [
      { "title": "Alpha", "subtitle": "First" },
      { "title": "Beta", "subtitle": "Second" }
    ]
  },
  "children": [
    { "kind": "javafx.scene.control.Label", "id": "result_title", "text": "{{item.title}} #{{$index}}" }
  ]
}
```

| field | type | meaning |
|---|---|---|
| `enabled` | `Boolean` | `true` = repeat this node's children as the item template. |
| `adapterId` | `String` | optional id of a top-level `dataAdapters[]` entry that supplies source metadata and preview rows. |
| `dataSource` | `String` | non-secret pointer such as `api.results` / `db.transactions`; register the source as an `api`/`database` library item. |
| `itemName` | `String` | template variable name; default is `item`. |
| `previewCount` | `Integer` | number of preview rows to expand; clamped to 1–100. |
| `sampleItems` | `Map<String,String>[]` | preview data used when live data is unavailable. |

Top-level adapters bridge registered data sources to repeater templates:
```json
{
  "dataAdapters": [
    {
      "id": "adapter-restaurants",
      "name": "Restaurants API",
      "sourceLibraryItemId": "lib-restaurants-api",
      "sourceKind": "api",
      "collectionPath": "data.results",
      "itemName": "restaurant",
      "fieldMappings": { "title": "name", "subtitle": "address" },
      "sampleItems": [
        { "name": "Cafe Azul", "address": "12 Market St" }
      ]
    }
  ]
}
```

During expansion, child ids get `__r1`, `__r2`, … suffixes; `text`, `promptText`, `accessibleText`, and
`accessibleHelp` interpolate `{{item.field}}`, `{{field}}`, and `{{$index}}`. Repeater-local `sampleItems`
override adapter samples; otherwise adapter `sampleItems` are mapped through `fieldMappings`. This is a
preview/export contract, not the live fetch itself: runtime API/database rows belong in every selected target's
manifest-declared data/action seam. Flagship native exports stamp expanded preview rows with generated
`NuiRepeaterBinding` metadata and expose `controls.bindRepeater("<adapter-or-source-id>", rows)` for fixed
row-pool binding; authored web lanes use their preserved `data-adapters` seam. Each selected target fetches,
maps, and applies equivalent rows without putting secrets in `dataSource`, adapters, or `sampleItems`.

## 4. Valid `kind` values

`kind` is a free **fully-qualified JavaFX class name string** (there is no enum). An unknown `kind` falls back
to a `Label` on load — so use one of these exactly. Adding a node by hand → pick the right `kind`:

**Layout / containers**
`javafx.scene.layout.Pane`, `.StackPane`, `.HBox`, `.VBox`, `.Region`, `.FlowPane`, `.BorderPane`,
`.GridPane`, `.AnchorPane`, `.TilePane`; `javafx.scene.Group`; `javafx.scene.text.TextFlow`

**Controls**
`javafx.scene.control.Label`, `.Button`, `.ToggleButton`, `.CheckBox`, `.RadioButton`, `.ComboBox`,
`.ListView`, `.TableView`, `.TreeView`, `.TreeTableView`, `.TabPane`, `.Accordion`, `.TitledPane`,
`.SplitPane`, `.ScrollPane`, `.TextField`, `.PasswordField`, `.TextArea`, `.Hyperlink`, `.Separator`,
`.ProgressBar`, `.ProgressIndicator`, `.Slider`

**Shapes**
`javafx.scene.shape.Rectangle`, `.Circle`, `.Ellipse`, `.Line`, `.Polygon`, `.Polyline`, `.Path`;
`javafx.scene.text.Text`

**Image**
`javafx.scene.image.ImageView`

---

## 5. `parentLayoutProps` — the `nui.*` (and bare JavaFX) keys

`Map<String,String>` carrying per-parent layout intent. Two families:

**Bare JavaFX constraint keys** (how a managed child sits in its parent):
`anchor.top|bottom|left|right` (AnchorPane), `hbox.hgrow|margin`, `vbox.vgrow|margin`,
`stack.alignment|margin`, `grid.fillWidth|fillHeight|halign|valign|hgrow|vgrow|margin`,
`border.alignment|margin`.

**`nui.*` keys** (typed CSS/model semantics, not a raw CSS escape hatch). Commonly seen (not exhaustive):
- Clipping / overflow: `nui.clipToBounds`, `nui.cssClipPath`, `nui.cssOverflowClipMode`, `nui.cssOverflowClipMargin`, `nui.cssTextOverflow`
- Text/line-box: `nui.cssLineHeightPx`, `nui.cssWhiteSpace`, `nui.cssWordBreak`, `nui.cssOverflowWrap`, `nui.tabSize`, `nui.textTop`
- Flex: `nui.flexGrowWeight`, `nui.flexSpacer`, `nui.hboxFillHeight`, `nui.vboxFillWidth`, `nui.semanticFlexGrow`, `nui.semanticVBoxGrow`, `nui.semanticFlexBasis`
- Grid: `nui.gridTemplateColumns`, `nui.gridTemplateRows`, `nui.gridAutoRows`, `nui.gridAutoColumns`, `nui.columnGap`
- Gaps: `nui.hgap`, `nui.vgap`
- Responsive twins: `nui.semantic`, `nui.semanticWidth`, `nui.semanticHeight`, `nui.semanticFlexGrow`, `nui.semanticVBoxGrow`, `nui.semanticFlexBasis`
- Positioning: `nui.pinScope`, `nui.pctTop|pctBottom|pctLeft|pctRight`, `nui.unmanaged`, `nui.semanticAnchor.*`
- Sizing flags: `nui.semanticMinWidth|semanticMaxWidth|semanticMinHeight|semanticMaxHeight`, `nui.semanticAspectRatio`
- CSS borders: `nui.cssBorder|cssBorderTop|cssBorderBottom|cssBorderLeft|cssBorderRight`, `nui.borderStyle`, `nui.strokeDashArray`

> Product-affecting `nui.*` keys must be backed by typed property-panel controls with live editor/webapp behavior.
> Importer-only compiler hints must be stripped before saved project state. Do not add raw CSS or generic `nui.*`
> key/value editing surfaces.

---

## 6. `libraryItems` — `LibraryItemState`

Repeated colors/fonts and reusable subtrees (navs, footers, cards) are promoted into `libraryItems`; stages
keep thin `libraryReference` shells (`libraryItemId` + `libraryReference:true`) that resolve on load/export.
**You get these for free from import — don't author them by hand.** Editing a single library color updates
every node that references it (one source of truth).

```jsonc
{ "id": "lib-style-color-14161c_1_000", "name": "Color #14161c",
  "assetType": "color", "assetPath": "#14161c@1.000", "rootNode": { /* sample Rectangle */ } }
```

| field | type | meaning |
|---|---|---|
| `id` | `String` | stable id referenced by `libraryItemId` / `*LibraryItemId`. |
| `name` | `String` | human label. |
| `assetType` | `String` | `color` \| `background-fill` \| `font` \| `border-stroke` \| `component`/`node` \| `api` \| `database` \| `image` \| `svg` \| `audio` \| `video` \| `theme`. |
| `assetPath` | `String` | the stored value for simple assets (e.g. a `color`'s `#rrggbb@alpha`, or a media path). |
| `configJson` | `String` | serialized config for `api` / `database` items. |
| `rootNode` | `NodeState` | the subtree (for `component`/`node`) or a sample node (color/font). |
| `parameterSchema` / `eventSchema` | arrays | publishable-component params/events. |

To **change a shared color** edit that item's `assetPath` (and the mirror `rootNode.fill` if present). To
**recolor one node only**, set that node's own `backgroundFill`/`fill`/`textFill` and **remove** its
`*LibraryItemId` so it stops resolving the shared value.

---

## 7. Interactions, divisions, timeline (reference)

- **`InteractionState`** `{id, trigger, action, targetStageId, targetNodeId, targetLibraryItemId, params}`.
  `trigger ∈ CLICK|DOUBLE_TAP|LONG_PRESS|HOVER|VALUE_CHANGE|INPUT|SUBMIT|FOCUS|BLUR|ON_LOAD|SCROLL|SWIPE_*|…`;
  `action ∈ NAVIGATE_TO_STAGE|OPEN_URL|CALL_API|CALL_DATABASE|PLAY_TIMELINE|TOGGLE_VISIBILITY|SET_STATE|…`.
  For nav, set `targetStageId` to a real `stages[].stageId`.
- **`DivisionState`** `{id, name, boundaryPx, condition}` where `condition ∈ "min"|"max"` (`min` = width ≥
  boundary; `max` = width < boundary; the boundary belongs to `min`). Comes from CSS `@media`.
- **`timeline`** (stage-level) — `@keyframes`/`animation` round-trip. `{durationSec, keys:[{nodeRefId,
  property, timeSec, value, valueType, colorValue, easing, ...}], nodePlayback:[...]}`. Edit animations by
  re-authoring `@keyframes`, not by hand.

---

## 8. Colors & paints (the storage format)

- **Solid color = `#rrggbb@alpha`** — lowercase 6-digit hex + `@` + 3-decimal alpha:
  `#000000@1.000`, `#ffffff@0.500`. Encoder is literally `String.format("#%02x%02x%02x@%.3f", r,g,b,a)`.
  This same form is used everywhere a color is stored: `backgroundFill`, `fill`, `textFill`, `stroke`,
  `borderStrokePaint`, `backgroundColor`, `boxShadow`'s color, `progressFillColor`/`progressTrackColor`,
  library color `assetPath`, timeline `colorValue`. **Always use this format** — `#fff` or `rgb(...)` will not
  round-trip.
- **Gradients** are a JavaFX-style CSS string (not `#rrggbb@alpha`), e.g.
  `linear-gradient(from 0% 0% to 100% 100%, #ffrrggbb 0%, #ffrrggbb 100%, proportional true)` with `#aarrggbb`
  ARGB stop colors. Don't hand-edit gradients — re-author the CSS.

---

## 9. Why hand-edits are safe — the round-trip-stability invariant

`serialize → deserialize → serialize` is a strict **fixpoint** (gated by `PaletteRoundTripStabilityTest`).
Modena (JavaFX default CSS) never enters the model. Consequences for hand-editing:

- A **valid** hand-edited `project.json` round-trips byte-stably: load → save is identity.
- A field written with the **wrong name or shape is silently dropped** on load (it's not in the schema). That
  is why every field name above is exact and why you must keep value formats (`#rrggbb@alpha`, `Class#ENUM`).
- So: edit a documented scalar/array field, keep its format, keep `id`s letter-first and unique, don't gut
  `libraryReference` shells or `resolved`/glyph-metric fields, and the project stays valid.

### When to DIRECT-EDIT `project.json` vs RE-AUTHOR HTML

**Direct-edit `project.json` (fast, targeted) for:**
- changing a **text** label (`text`), a **color** (`backgroundFill`/`fill`/`textFill` or a library
  `assetPath`), a **font size/weight** (`fontSize`/`fontWeight`/`fontWeightNumeric`);
- moving/resizing an **absolutely positioned** node (`layoutX/Y` on an AnchorPane/Pane child, or
  `anchor.top/left/...`; explicit `prefWidth/prefHeight` only for intrinsic/overlay geometry). Keep normal
  flex/grid/stack children auto-sized and parent-owned;
- toggling a control value (`selected`, `progress`, `sliderValue`, `items`);
- **adding / removing / reordering** a node in a `children` array (give new nodes a valid `kind` + a unique
  letter-first `id`);
- editing an interaction target or a shared library color.

**Re-author the HTML and re-import (`nui-import.mjs`) for:**
- structural redesign / new layout, changing flex/grid behavior, responsive `@media`, `@keyframes`
  animations, or anything touching `nui.*` `parentLayoutProps` or glyph/text geometry — those are *importer
  decisions* and are error-prone to forge by hand. Re-import preserves `NuiBackend` code on re-export.

> **ALWAYS run `nui-validate.mjs` after a direct edit, before export.** It catches malformed JSON, a bad
> `version`, missing `stages[].rootNodes[]`, invalid `kind`, non-letter-first ids, and type slips before they
> reach the exporter. See "Validate after a direct edit" below.

---

## 10. Granular / fragment editing (regenerate one part)

Instead of re-authoring a whole screen, you can round-trip a **single component/section** through the
importer/exporter and splice the resulting node subtree into an existing `project.json`:

- **`nui-fragment-import.mjs`** — HTML/CSS snippet (one `<div class="card">…</div>` etc.) → a **NodeState
  subtree** (a JSON array of nodes, no stage scaffolding). Splice it into a stage's `rootNodes` or into a
  node's `children`, then run `nui-validate`.
- **`nui-fragment-extract.mjs`** — pull one node (by `id`) out of a `project.json` back to an HTML/CSS
  snippet, edit the HTML, and re-import the fragment.

See SKILL.md step 6 (Iterate → "Granular edits") for the splice workflow. Direct `project.json` editing
(§9) is the primary granular path; fragments are for regenerating a self-contained part from HTML.

---

## 11. Validate after a direct edit

```bash
node ${CLAUDE_SKILL_DIR}/../../bin/nui-validate.mjs project.json
```
Runs an **authoritative model round-trip** via the export service when you're authed (the service
deserializes the JSON into the real `ProjectState`, re-serializes, and confirms it's accepted), and **always**
runs a **structural** check in pure Node (well-formed JSON; `version`; non-empty `stages[].rootNodes[]`;
valid `kind` values; letter-first ids; obvious type errors). Pass `--structural` to skip the service call.
It **fails closed** with a clear message — fix the JSON before exporting. (Structural-only validation does not
prove the model accepts every nested field; the service round-trip does.)

---

## 12. Toolchain commands

### Cloud (installed plugin default — needs NativeUI SSO session; auth + subscription enforced server-side)
```bash
node ${CLAUDE_SKILL_DIR}/../../bin/nui-import.mjs   home.html settings.html -o project.json
node ${CLAUDE_SKILL_DIR}/../../bin/nui-validate.mjs project.json
node ${CLAUDE_SKILL_DIR}/../../bin/nui-export.mjs   project.json --platform android -o ./android-out
node ${CLAUDE_SKILL_DIR}/../../bin/nui-export.mjs   project.json --platform ios     -o ./ios-out
# granular:
node ${CLAUDE_SKILL_DIR}/../../bin/nui-fragment-import.mjs  card.html  -o card-subtree.json
node ${CLAUDE_SKILL_DIR}/../../bin/nui-fragment-extract.mjs project.json --id trip_card -o card.html
```
Underlying HTTP (what the clients POST to `$NATIVEUI_EXPORT_URL`, `Authorization: Bearer $NATIVEUI_TOKEN`):
`/export/import/html`, `/export/android|ios[/manifest]`, `/export/import/fragment`, `/export/fragment`.
> Empty/invalid body → 400; oversized → 413; missing/expired token or no subscription → 401/403.

### Local dev (inside the NativeUI repo — no token)
```bash
# Run the export service locally with auth disabled, then point the clients at it:
EXPORT_AUTH_ENABLED=false PORT=8090 ...   # export.auth.enabled=false / export.subscription.required=false
# Import one HTML page -> patch JSON:
java -cp "$(cat nui-core/target/cp.txt):nui-core/target/classes" com.nui.html.HtmlImportTool --html-file page.html
```

---

## 13. Native project layout (what the dev gets)

Each export ZIP is a complete native project:
- **Android**: a Gradle / Android-Studio project — `app/src/main/{kotlin,res}`, generated `MainActivity` +
  layout + `NuiScreenControls`/`NuiScreenDelegate`/`GeneratedInteractions`, and a scaffolded `NuiBackend.kt`.
- **iOS**: an Xcode project — `Generated*` (factory, view controller, app delegate) + a scaffolded
  `NuiBackend.swift`.
Open in Android Studio / Xcode to build + run. Keep `NuiBackend.*` as thin delegation and put durable app logic
in `*BackendConnector.*` classes (see `backend-contract.md`).
