---
name: nativeui-connect
description: >-
  Wire backend behavior into an exported NativeUI app — APIs, database, navigation, button taps, login,
  data fetching, events — across BOTH iOS and Android. Use when the user asks to connect/wire up/hook up
  the backend, implement onScreenReady, handle a tap or form submit, call an API or database, or respond
  to a NAVIGATE_TO_STAGE / CALL_API interaction. Reads project.json to enumerate screens, node ids, and
  authored interactions, plans durable *BackendConnector.kt / *BackendConnector.swift classes, and keeps
  NuiBackend.kt / NuiBackend.swift as thin write-once delegators — never touching generated files.
metadata:
  argument_hint: "[project.json] [what to connect]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Read Write Edit Grep Glob"
---

# Wire NativeUI backend (both platforms)

Add behavior to an exported app through app-owned backend files only. `NuiBackend.kt` (Android) and
`NuiBackend.swift` (iOS) should stay thin write-once delegators; durable app/backend logic belongs in
`*BackendConnector.kt` and `*BackendConnector.swift` classes. Everything else — UI, the
`NuiScreenControls`/`NuiScreenDelegate` contract — is generated and **must never be edited**. Full rules:
`${CLAUDE_SKILL_DIR}/../nativeui/references/backend-contract.md`.

`<bin>` = `${CLAUDE_SKILL_DIR}/../../bin`.

## 1. Preflight
```bash
node <bin>/preflight.mjs
```
Stop on non-zero exit and relay the remedy (this skill operates on an exported app, but keep the account gate
consistent; if a re-export is needed below, it is required).

## 2. Read the project + enumerate the contract surface
Read the `project.json` argument (default `./project.json`) and build the **wiring map** — exactly what the
generated `NuiScreenControls`/`NuiScreenDelegate` will expose (see
`${CLAUDE_SKILL_DIR}/../nativeui/references/backend-contract.md` for the full vocabulary, and
`../nativeui/references/project-model.md` for the schema).

**a) Named controls → typed accessors.** Walk every `stages[].rootNodes[]` tree (recurse into each node's
`children[]`) and collect the `id` of any node you'll read or drive (`<button>`→Button, inputs→TextField/
PasswordField/TextArea, `<select>`→ComboBox, `<input type=range>`→Slider, checkboxes/toggles, lists, and the
Labels whose `text` you'll update). For each id, note the node's `kind` — that fixes the native view type the
accessor returns (`javafx.scene.control.Button` → Android `Button` / iOS `UIButton`; `.TextField` → `EditText` /
`UITextField`; `.Slider`→`SeekBar`/`UISlider`; `.CheckBox`→`CheckBox`/`UISwitch`-style; `.ComboBox`→spinner/
picker; `.Label`→`TextView`/`UILabel`). The accessor name is the id **camelCased** (`login_button` →
`loginButton`). **Android only surfaces a typed accessor for a letter-first id** — a digit-first id gets an
unstable sequence id and no accessor (reachable only via `view(id)` at that sequence id). If the user wants a
digit-first id wired, tell them to rename it letter-first in the design and re-import (nativeui-update).

**b) Authored interactions → delegate hooks.** Collect interactions from BOTH `stages[].interactions[]`
(stage-scoped, e.g. an `ON_LOAD`) and each node's `interactions[]` (node-scoped, the `InteractionState`
`{trigger, action, targetStageId, targetNodeId, params}`). Bucket each `action` by where it lands:
- `CALL_API` → you implement `onCallApi(target, params)`. The `target` is the interaction's target id (a
  `libraryItems[]` `api` item or the authored name); `params` carries the authored params.
- `CALL_DATABASE` → `onCallDatabase(target, params)`.
- `PLAY_TIMELINE` → `onPlayTimeline(target, params)` (only if you intercept; the base on-load timeline plays
  itself — see step 4).
- `NAVIGATE_TO_STAGE` → already works with zero code (the native swaps screens); `onNavigateToStage(target)`
  fires after for optional app logic only.
- `TOGGLE_VISIBILITY` / `ANIMATE_PANEL` → run on device with **zero backend code**; don't wire them.
- `OPEN_URL` / `SUBMIT_FORM` / `RUN_SCRIPT` / `SET_STATE` → **captured but no runtime path**: do the work
  yourself in `onScreenReady` via a typed accessor (e.g. a `<form>` becomes SUBMIT/`SUBMIT_FORM` with
  `params.action`+`params.method` but you POST yourself; an `onclick="save()"` becomes CLICK/`RUN_SCRIPT` with
  `params.handler="save()"` — you implement `save()` here).

**c) Library APIs/DBs.** `libraryItems[]` entries with `assetType` `api` / `database` (config in `configJson`)
name the endpoints the `CALL_API`/`CALL_DATABASE` targets refer to.

**d) Repeaters/data lists.** If a node has `repeater.enabled`, treat it as preview/template metadata plus an
optional `repeater.adapterId` link. Confirm the referenced `dataAdapters[]` entry points at a registered
`api`/`database` library item and maps source fields into the template placeholders, then implement live data
behavior identically in Android and iOS connectors. Native exports provide a generated row-pool helper on
`NuiScreenControls`: use `controls.bindRepeater("<adapter-or-source-id>", rows)` when the planned repeater
has preview rows; only drop to manual `ListView`/`ComboBox`/dynamic views when that design intentionally
requires a different runtime surface.

Then generate the connector plan:
```bash
node <bin>/nui-connectors-plan.mjs project.json --human
```
Summarize this map for the user before writing code: the ids you'll wire (with their native types), the
`onCallApi`/`onCallDatabase`/`onPlayTimeline` targets, and the connector class names/paths per screen.

## 3. Locate backend delegators and create connector classes — both platforms
In the exported projects, find the write-once backend delegator files (Glob):
- Android: `**/NuiBackend.kt` (lives next to the generated Kotlin, e.g. `app/src/main/kotlin/.../NuiBackend.kt`)
- iOS: `**/NuiBackend.swift` (lives in `App/NuiBackend.swift`)
Each export **scaffolds these once on first export and never overwrites them**, so normally they already exist
— extend them only enough to instantiate/register/delegate to connector classes, preserving existing user code.
Scaffold a delegator ONLY if it's genuinely missing (e.g. you were handed a `project.json` and are wiring before
exporting), using the exact shapes the exporter emits:
```kotlin
// Android — NuiBackend.kt   (a singleton object implementing the generated interface)
object NuiBackend : NuiScreenDelegate {
    private val loginConnector = LoginBackendConnector()
    override fun onScreenReady(controls: NuiScreenControls) {
        loginConnector.onScreenReady(controls)
    }
    override fun onCallApi(target: String, params: Map<String, String>) {
        loginConnector.onCallApi(target, params)
    }
}
```
```swift
// iOS — App/NuiBackend.swift  (a class with a `shared` singleton; GeneratedInteractions.delegate points at it)
final class NuiBackend: NuiScreenDelegate {
    static let shared = NuiBackend()
    private let loginConnector = LoginBackendConnector()
    func onScreenReady(_ controls: NuiScreenControls) {
        loginConnector.onScreenReady(controls)
    }
    func onCallApi(_ target: String, params: [String: String]) {
        loginConnector.onCallApi(target, params: params)
    }
}
```
Create the planned connector classes next to the backend delegator (Android package folder) and under `App/`
on iOS, for example `LoginBackendConnector.kt` and `LoginBackendConnector.swift`. Override/delegate only the
hooks you need (every `NuiScreenDelegate` method has an empty default). Never edit any generated file — if you
reach for `MainActivity`, a `Generated*`, `NuiScreenControls`, or `NuiScreenDelegate`, stop.

## 4. Implement the behavior in connector classes — BOTH platforms, mirrored
Use the typed accessors and the delegate hooks from the step-2 map; do not re-find views. Stub each connector:

- **`onScreenReady(controls)`** — the main entry. Attach listeners, read inputs, populate data:
  - Android: `controls.loginButton.setOnClickListener { val email = controls.emailField.text.toString(); … }`
  - iOS: `controls.loginButton.addAction(UIAction { _ in let email = controls.emailField.text ?? ""; … }, for: .touchUpInside)`
  - Adapter-backed repeaters: fetch/map rows in the connector, then call Android
    `controls.bindRepeater("adapter-results", rows)` where `rows` is `List<Map<String, String>>`, and iOS
    `controls.bindRepeater("adapter-results", rows)` where `rows` is `[[String: String]]`.
  - Populate list/label content here (it's the consistent point on both platforms — see the `ON_LOAD` ordering
    caveat in the contract reference).
- **`onCallApi(target, params)`** — `when`(Kotlin)/`switch`(Swift) on `target`, one branch per authored
  `CALL_API` from the map. Read `params[...]` for the authored arguments; call your real API; update controls
  back on the main thread.
- **`onCallDatabase(target, params)`** — same shape for authored `CALL_DATABASE` actions.
- **`onNavigateToStage(target)`** — implement ONLY to add app logic after a screen swap; navigation already
  works without it.
- **`onPlayTimeline(target, params)`** — implement ONLY to intercept an authored `PLAY_TIMELINE`. The BASE
  on-load `@keyframes` timeline auto-plays on device with no code; per-state animations (`:hover`/`:active`/…)
  do NOT auto-fire — if the design wants one to run on a tap, add a listener in `onScreenReady` that triggers it.
- **No-runtime-path actions** (`OPEN_URL`, `SUBMIT_FORM`, `RUN_SCRIPT`, `SET_STATE`): there is no hook — do the
  work in `onScreenReady` via a typed accessor (open the URL, POST the form, run the script's intent, mutate state).

Implement the **same logic on Android and iOS** for the same controls/targets, in each language's idioms.
Behavior only — anything visual (colors, layout, show/hide, base animation) belongs in the HTML/CSS design.
Set non-image accessibility labels in connectors too (icon-only buttons etc. — see backend-contract.md →
Accessibility).

## 5. Re-export if a design change was required
If you had to rename ids or change the design, re-author + re-import the affected screen (see nativeui-update),
then re-export both platforms — `NuiBackend.*` and connector classes survive regeneration:
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```

## Hard rules
1. Edit ONLY app-owned backend files: thin `NuiBackend.kt` / `NuiBackend.swift` delegation and durable
   `*BackendConnector.kt` / `*BackendConnector.swift` logic. If you reach for `MainActivity`, any `Generated*`,
   `NuiScreenControls`, or `NuiScreenDelegate`, stop — it belongs in a connector or the design.
2. Always do BOTH platforms for the same design.
3. Renaming/deleting a wired node id fails LOUDLY at runtime by design; keep ids stable and update both
   connector classes when an id changes.

## Next: stand up the server those endpoints call

Wiring connector classes only makes the app *call* a backend — it does not create one. Once you know which
endpoints the connectors need (the `onCallApi` / `onCallDatabase` targets + any form POST you wired by hand),
use the **nativeui-backend** skill to **scaffold AND deploy** the actual server: it derives that same endpoint
list from `project.json`, recommends a stack from your installed toolchain (Node / Python / Supabase·Firebase /
Mock-for-prototyping), generates a runnable server with one route per endpoint, points the connector/base URL at its
base URL (handling iOS ATS / Android cleartext for local dev, HTTPS for prod), and deploys it (Cloud Run /
Fly·Railway·Render / Vercel·Netlify / Docker-on-VPS). For a quick end-to-end on device with no cloud, its
**Mock / local-first** stack returns canned JSON for every route — swap in a real backend later without
changing the wiring here.
