# NativeUI backend contract — wire behavior without touching generated UI

The designer owns the UI and re-exports freely; application behavior lives behind a generated typed contract.
**Never edit generated UI.** Read `nativeui-export-manifest.json` for the exact durable seam:

| Target family | Durable seam |
| --- | --- |
| SwiftUI / UIKit | `AppActions.swift` / thin `NuiBackend.swift` plus connectors |
| Compose / Android Views | `NuiAppActionsImpl.kt` / thin `NuiBackend.kt` plus connectors |
| Rust | `src/app_actions.rs` |
| C# | `AppActions.cs` |
| Vanilla web/PWA | `app-actions.js`, `data-adapters.js`, `custom-components.js` |
| React / Vue | `app/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` |
| Angular | `src/app/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` |
| Astro | `src/seams/app-actions.ts`, `data-adapters.ts`, `custom-components.ts` |

New implementations use the asynchronous `NuiActionResult` contract for control mutations, list data,
navigation, and structured errors. Generated adapters preserve existing synchronous hooks and delegates.

## Three layers — what's safe to edit
| Layer | Files | Regenerated each export? | Edit it? |
|---|---|---|---|
| Generated UI | `MainActivity.kt` + layout XML / drawables · `NuiGenerated/Runtime/NuiViewFactory.swift` + `App/MainViewController.swift` + `App/AppDelegate.swift` | **yes** | ❌ NEVER |
| Contract | `NuiScreenControls` + `NuiScreenDelegate` (+ `GeneratedInteractions` routing) | **yes** | ❌ NEVER |
| Backend delegator | `NuiBackend.kt` / `App/NuiBackend.swift` | **no** (scaffolded once, then never overwritten) | ✅ YES — thin delegation only |
| App connectors | `*BackendConnector.kt` / `*BackendConnector.swift` | **no** (app-owned files) | ✅ YES — durable app/backend logic |

Re-exporting after a design change regenerates the UI + contract around your untouched `NuiBackend.*` and
connector classes.

## What you get (generated, typed)
**`NuiScreenControls`** — one typed accessor per designer-named node, plus an untyped `view(id)` fallback:
```kotlin
// Android (generated)
val loginButton: android.widget.Button get() = requireView("login_button")
val emailField: android.widget.EditText get() = requireView("email_field")
```
```swift
// iOS (generated)
var loginButton: UIButton { requireView("login_button") }
var emailField: UITextField { requireView("email_field") }
```
**`NuiScreenDelegate`** — the hook surface (all methods have empty defaults; implement only what you need):
`onScreenReady(controls)`, `onNavigateToStage(target)`, `onCallApi(target, params)`,
`onCallDatabase(target, params)`, `onPlayTimeline(target, params)`.

## What you write (legacy UIKit/Views example)
```kotlin
// Android — NuiBackend.kt stays thin
object NuiBackend : NuiScreenDelegate {
    private val loginConnector = LoginBackendConnector()
    override fun onScreenReady(controls: NuiScreenControls) = loginConnector.onScreenReady(controls)
    override fun onCallApi(target: String, params: Map<String, String>) =
        loginConnector.onCallApi(target, params)
}

// Android — LoginBackendConnector.kt owns app logic
class LoginBackendConnector {
    fun onScreenReady(controls: NuiScreenControls) {
        controls.loginButton.setOnClickListener {
            val email = controls.emailField.text.toString()
            // … validate, call your API, navigate …
        }
    }
    fun onCallApi(target: String, params: Map<String, String>) { /* route by target */ }
}
```
```swift
// iOS — App/NuiBackend.swift stays thin
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

// iOS — App/LoginBackendConnector.swift owns app logic
final class LoginBackendConnector {
    func onScreenReady(_ controls: NuiScreenControls) {
        controls.loginButton.addAction(UIAction { _ in
            let email = controls.emailField.text ?? ""
            // … validate, call your API, navigate …
        }, for: .touchUpInside)
    }
    func onCallApi(_ target: String, params: [String: String]) { /* route by target */ }
}
```

## Rules when wiring backend
1. **Edit only app-owned backend files.** `NuiBackend.kt` / `NuiBackend.swift` delegate; connector classes own
   behavior. Never touch any generated file. If you find yourself editing `MainActivity`, a `Generated*` file,
   `NuiScreenControls`, or `NuiScreenDelegate`, stop — that work belongs in a connector or in the design
   (HTML/CSS).
2. **Do every selected target.** Implement equivalent behavior in each manifest-declared durable seam for the
   same controls/actions. For the flagship mobile pair, this means both Android and iOS; shared Rust/C# projects
   and authored web lanes use the family-specific seams below.
3. **Use the typed accessors** (`controls.loginButton`) and the delegate hooks. For designer-authored events
   (a tapped button wired to "call API X" / "go to screen Y"), implement the matching `onCallApi` /
   `onNavigateToStage` case rather than re-finding views.
4. **Behavior, not appearance.** Anything visual (colors, layout, animation, showing/hiding, navigation chrome)
   belongs in the HTML/CSS design and re-import — not in backend code.

## Lifecycle / ordering
- Android: `MainActivity.onCreate` → layout inflated → `GeneratedInteractions.bind` →
  `NuiBackend.onScreenReady(NuiScreenControls(this))`.
- iOS: `viewDidLoad` → root built → `GeneratedInteractions.shared.delegate = NuiBackend.shared` →
  `onScreenReady` → then authored `ON_LOAD` events fire (load-time `CALL_API` reaches the backend).
- **`ON_LOAD` ordering differs per platform.** iOS: `onScreenReady` runs FIRST, then authored `ON_LOAD` events fire (a load-time `CALL_API` reaches the delegate after the screen is handed over). Android: authored `ON_LOAD` fires inside `GeneratedInteractions.bind`, which runs BEFORE `onScreenReady`. Don't depend on `ON_LOAD` and `onScreenReady` order across platforms — do data population in `onScreenReady` (consistent on both), and treat `ON_LOAD` interactions as best-effort.
- **`NAVIGATE_TO_STAGE` needs zero backend code** — a `<a href>` tap swaps screens on both natives out of the box. `onNavigateToStage(target)` still fires after the swap for optional app logic; you do NOT implement it just to make navigation work.

## Interactions — the full trigger + action vocabulary
The importer captures the portable HTML event surface into each node's `interactions` (trigger → action).
Trigger/action values are free-form strings; the recognized constants below are reconciled against every
selected target's export manifest. Authored events come from `<a href>`, `<form>`, and `on*` attributes — there
is no other plain-HTML syntax for them.

**Triggers** (exact names): `CLICK` `DOUBLE_TAP` `LONG_PRESS` `MOUSE_DOWN` `MOUSE_UP` `CONTEXT_MENU` `HOVER` `HOVER_END` `SWIPE_UP` `SWIPE_DOWN` `SWIPE_LEFT` `SWIPE_RIGHT` `VALUE_CHANGE` `INPUT` `SUBMIT` `RESET` `FOCUS` `BLUR` `KEY_DOWN` `KEY_UP` `KEY_PRESS` `ON_LOAD` `SCROLL`.

**Actions** (exact names): `NAVIGATE_TO_STAGE` `OPEN_URL` `SUBMIT_FORM` `ANIMATE_PANEL` `TOGGLE_VISIBILITY` `PLAY_TIMELINE` `CALL_API` `CALL_DATABASE` `SET_STATE` `RUN_SCRIPT`.

**What runs on the flagship mobile pair with ZERO backend code** (both native exporters execute these in
`GeneratedInteractions.perform`; Rust, C#, and web use their own manifest-receipted lowering):
| Action | On-device behavior |
|---|---|
| `TOGGLE_VISIBILITY` | toggles the target view's visible/hidden |
| `ANIMATE_PANEL` | slides the target in from `params.fromSide` (`left`/`right`/`top`/`bottom`) over `params.duration` ms (default 300) |
| `NAVIGATE_TO_STAGE` | swaps to the target screen (iOS rebuilds + swaps the root; Android toggles the `nav_stage_<id>` container). `NuiBackend.onNavigateToStage(target)` ALSO fires for optional app logic. |

**Backend-routed — captured + gesture-bound but a NO-OP until your backend delegator/connector implements it** (these call a `NuiScreenDelegate` method whose default body is empty):
`CALL_API` → `onCallApi(target, params)` · `CALL_DATABASE` → `onCallDatabase(target, params)` · `PLAY_TIMELINE` → `onPlayTimeline(target, params)`.

**Flagship mobile pair limitation:** `OPEN_URL`, `SUBMIT_FORM`, `RUN_SCRIPT`, and `SET_STATE` have no direct
`GeneratedInteractions.perform` case or delegate hook there; implement the needed behavior in an app-owned
connector via typed controls. Do not project that limitation onto other lanes: web, Rust, and C# must follow
their target manifest's exact action disposition and implementation receipt. A web lane compiles safe local
state/form behavior directly and routes external effects through its preserved seams; opaque imported
`RUN_SCRIPT` text is never blindly executed.

## `on*` handlers, `<a href>`, `<form>` — what import captures
- **`on*` attributes** become an interaction with `action=RUN_SCRIPT`. The JS body is **opaque** — it is NOT executed; it is stored verbatim in `params.handler` (truncated to 240 chars). Implement the real logic in a connector. Handler→trigger map (only the first handler per trigger wins): `onclick`→CLICK, `ondblclick`→DOUBLE_TAP, `oncontextmenu`→CONTEXT_MENU, `onmousedown`→MOUSE_DOWN, `onmouseup`→MOUSE_UP, `onmouseover`/`onmouseenter`→HOVER, `onmouseout`/`onmouseleave`→HOVER_END, `onchange`→**VALUE_CHANGE**, `oninput`→**INPUT** (distinct from change), `onsubmit`→SUBMIT, `onreset`→RESET, `onfocus`/`onfocusin`→FOCUS, `onblur`/`onfocusout`→BLUR, `onkeydown`→KEY_DOWN, `onkeyup`→KEY_UP, `onkeypress`→KEY_PRESS, `onscroll`→SCROLL, `onload`→ON_LOAD. Example: `<button onclick="save()">` → CLICK/RUN_SCRIPT with `params.handler="save()"` (you implement `save()` in a connector).
- **`<a href>`**: internal anchor (`#…`) → CLICK/`NAVIGATE_TO_STAGE`; external (`http://`,`https://`,`//`,`mailto:`,`tel:`) → CLICK/`OPEN_URL` with `params.href`. `href="#"` and `javascript:` hrefs are ignored.
- **`<form>`**: → SUBMIT/`SUBMIT_FORM` (carries `params.action`/`params.method`).
- **Note:** node-level `on*` capture is SKIPPED if the node already carries interactions from the model's own round-trip — authored interactions win.

## The known edge — renames/deletions
If the designer renames/deletes a node the backend uses, the typed accessor fails LOUDLY at runtime
(`IllegalStateException` / `fatalError` naming the missing id). Intended — no silent fallback. When you change
a node's id in the design, update references in every selected target's manifest-declared durable seam.

## Id stability (for backend access)
- iOS surfaces every named node (ids sanitized to `[A-Za-z0-9_-]`).
- **Android resource ids can't start with a digit** → such ids get an unstable sequence id and **no typed
  accessor**. Name nodes letter-first for stable Android access. Accessor names are camelCased
  (`login_button` → `loginButton`).

## State & data — managing app state through connectors
The generated layer is **stateless** beyond the view tree: it builds the UI, exposes typed control accessors,
and routes interactions to the delegate. Project `dataAdapters[]` are design-time contracts for repeaters
(source + field mapping + preview rows), not generated live fetchers. Native exports do generate a small
row-pool binding helper for expanded repeater previews, but there is **no generated state container or live
fetch engine** — app state and data live in **your** connector/app code. What's
generated vs app-code:

| Concern | Generated (don't write) | App code in connectors (you write) |
|---|---|---|
| View tree + typed accessors | ✅ `NuiScreenControls` | — |
| Interaction routing | ✅ `GeneratedInteractions` → delegate | — |
| **App / screen state** | — | a property/field on a connector/store, mutated in the hooks |
| **List / collection data** | ✅ repeater row metadata + `controls.bindRepeater(...)` for preview row pools | fetch/map rows, call the helper, or own a custom list surface |
| **Shared / navigation state** | — | a connector/app-owned store read in each screen's `onScreenReady` |
| **Persistence** | — | platform storage (DataStore/Room, UserDefaults/files) |

- **App state** — hold it in connector classes or a shared app store referenced by those connectors. Keep
  `NuiBackend.*` thin so UI regeneration and backend evolution do not collide.
- **List / collection data** — NativeUI has model/editor **repeater + adapter metadata**: a container's children
  are the item template, `repeater.adapterId` can reference a `dataAdapters[]` entry, `repeater.dataSource`
  can name a registered source, adapter/repeater `sampleItems` drive native/web preview rows, and export
  expands ids to `__r1`, `__r2`, … while interpolating `{{item.field}}` and `{{$index}}`. Plain HTML import
  still starts as concrete rows; the repeater flag and adapter are `project.json`/editor-level annotations.
  Treat adapter `sourceLibraryItemId` and `repeater.dataSource` as non-secret pointers to registered
  `api`/`database` library items. For **live runtime data**, each selected target's app-owned data seam owns the
  fetch. The flagship mobile pair can pass mapped rows to
  `controls.bindRepeater("<adapter-or-source-id>", rows)` for its preview row pool; authored web lanes implement
  the same loading/empty/error/success behavior through their preserved `data-adapters` seam.
  The helper updates templated text/prompt/accessibility fields and hides unused preview rows. Use custom
  `ListView` / `ComboBox` / app-owned views only when the design intentionally needs a different runtime
  surface.
- **Shared / navigation state** — `NAVIGATE_TO_STAGE` carries no payload. Pass data between screens through a
  connector/app-owned store: set it before navigating (or in `onNavigateToStage(target)`), read it in the
  destination screen's `onScreenReady`.
- **Persistence** — use target-appropriate storage from the app-owned seam: Android
  `SharedPreferences`/Jetpack `DataStore`/Room, iOS `UserDefaults`/files/a database, browser storage or an API for
  web, and the selected desktop lane's storage abstraction. The contract imposes nothing here — it is ordinary
  app code. Keep the same logical keys and data shape across every selected target so behavior stays equivalent.

## Secrets — never hardcode keys
The exported native project is shipped to devices and is decompilable; **never hardcode API keys, tokens, or
secrets in `NuiBackend.*`, connector classes, or anywhere else in the project source. They are not the
importer's/exporter's concern — this is your responsibility in app code:
- **Build-time config / env** — inject non-secret config via the build (Android `BuildConfig` field from a
  Gradle property / `local.properties` kept out of VCS; iOS `.xcconfig` / `Info.plist` build setting). Keep the
  actual values out of source control.
- **Runtime secure storage** — store user tokens/credentials in the platform secure store: **Android
  EncryptedSharedPreferences** (Jetpack Security) or the **Android Keystore**; **iOS Keychain**. Read them in
  connectors at use time; never log them.
- **Prefer a backend proxy** — the safest pattern is to keep third-party secrets on YOUR server and have the app
  call your endpoint (an authored `CALL_API` → `onCallApi`), so the device never holds the third-party key.
- Don't commit `~/.nativeui/credentials.json` or the dev Firebase key into the app project — those are the
  plugin's toolchain creds, unrelated to the app's own secrets.

## Accessibility — author semantics first, use seams only for runtime labels
The importer preserves the supported portable accessibility contract, including image `alt`, `aria-label`,
resolved `aria-labelledby`, portable `role`, role description, help/description text, and hidden state. Author
these semantics in the HTML so every selected lane receives them; arbitrary `data-*` attributes are stripped,
while documented reserved portable `data-nui-*` carriers are allowed.
- **`<img alt="…">` is imported** as the node's accessibility label (`accessibleText`) — exported to Android
  `android:contentDescription`, iOS `accessibilityLabel`, and semantic web markup. Always give meaningful images
  an `alt`.
- **Label resolution (export):** the native label is the first non-blank of `accessibleText` (from `alt`) →
  the node's **visible text** → its **placeholder**. So a `<button>Save</button>` is already labelled "Save" and
  a placeholdered field is labelled by its placeholder — you only need to add labels where there's no visible
  text (icon buttons, image buttons, decorative-but-meaningful images without `alt`).
- **Set truly runtime-derived labels** in each selected target's app-owned seam. For the flagship mobile pair,
  use the typed accessor in connector `onScreenReady`:
  ```kotlin
  // Android
  controls.menuButton.contentDescription = "Open menu"
  ```
  ```swift
  // iOS
  controls.menuButton.accessibilityLabel = "Open menu"
  ```
  (For a purely decorative element, exclude it instead: Android `importantForAccessibility = "no"`, iOS
  `isAccessibilityElement = false`.)

## Rust lane
The Rust target group emits one shared cross-platform Cargo project. **Detailed spec:**
`docs/rust-backend-contract.md`.
Key differences to hold in mind when wiring a Rust app:

- **One seam, no twin.** Everything goes in the single write-once `src/app_actions.rs` — a `struct AppActions`
  implementing `nui_rt::actions::NuiBackend`. There is **no** thin-delegator + `*BackendConnector` split (one
  target ⇒ one file). Re-export regenerates `main.rs`/`screens/*.rs` around it; a changed stub lands as
  `app_actions.rs.new`.
- **Superset trait (11 hooks), all default no-op.** `on_screen_ready`, `on_navigate_to_stage`, `on_call_api`,
  `on_call_database`, `on_play_timeline`, `on_open_url`, `on_submit_form`, `on_set_state`, `on_run_script`,
  `on_animate_panel`, `fetch_list`. Unlike mobile (where `OPEN_URL`/`SUBMIT_FORM`/`SET_STATE`/`RUN_SCRIPT` have
  *no* runtime path and you wire them yourself), Rust routes **all** of these to real hooks.
- **Export-compiled, not listener-attached.** You do **not** fetch a control and add a listener. Authored taps
  compile to `TapAction`s at export; you implement the hooks and route by `target`. Framework-owned actions
  (`NAVIGATE_TO_STAGE`/`TOGGLE_VISIBILITY`/`ANIMATE_PANEL`/tab-group select) run with zero backend code.
- **Read-only controls.** `on_screen_ready(controls)` gives `controls.node(id) -> Option<&SceneNode>` — you
  **read** node state; there is no mutable view hierarchy. Change appearance in the design (HTML/CSS), not at
  runtime. A renamed id is a silent `None` (guard it), not a loud crash.
- **Async result path plus compatibility hooks.** New handlers return a future resolving to `NuiActionResult`;
  the legacy synchronous trait hooks remain available through the compatibility adapter.
- **Base URLs:** localhost reaches a dev server directly on host + iOS Simulator — no `10.0.2.2`, no ATS
  cleartext config. Use `reqwest`/`ureq` from `app_actions.rs`; keep secrets out of shipped source.

## C# and authored web seams

C# implements `ValueTask<NuiActionResult>` in shared `AppActions.cs`; desktop, iOS, and Android hosts consume
the same generated stage registry and seam.

Every web lane emits semantic routes, native controls, and lane-native behavior. Navigation, local state,
visibility, selection, form mechanics, and timelines are compiled directly into ES modules, React Router,
Nuxt/Vue, Angular, or Astro source. Application-owned work is split across three explicit seams:

- `app-actions.*` handles external effects and returns `ActionResult` values for mutations, navigation, list
  data, and structured errors.
- `data-adapters.*` loads and maps live data. Keep API, authentication, POST, and user-specific responses out
  of service-worker caches unless an approved offline-data policy says otherwise.
- `custom-components.*` integrates hand-authored elements or framework components at the exported extension
  points.

Vanilla uses the root JavaScript files shown above. React and Vue use `app/seams/*.ts`, Angular uses
`src/app/seams/*.ts`, and Astro uses `src/seams/*.ts`; always trust the target's `writeOnceFiles` manifest over
a memorized path. Framework handlers return `Promise<ActionResult>` with generated `contracts.ts` types;
vanilla exposes the equivalent Promise contract with `contracts.d.ts`.

The exporter regenerates contracts and UI source but preserves all three implementations and `.gitignore`.
When a generated contract changes, re-export writes the fresh implementation candidate beside the preserved
file with a `.new` suffix. Review and merge that candidate deliberately; never replace the preserved seam
blindly.
