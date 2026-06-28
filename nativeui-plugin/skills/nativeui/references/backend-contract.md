# NativeUI backend contract — wire behavior without touching generated UI

The designer owns the UI and re-exports freely; you add backend behavior independently through a generated,
typed contract. **Never edit generated UI or contract files.** Keep `NuiBackend.kt` (Android) and
`NuiBackend.swift` (iOS) as thin write-once delegators; put durable app/backend logic in
`*BackendConnector.kt` and `*BackendConnector.swift` classes. *(Authoritative source in the repo:
`docs/native-backend-contract.md`.)*

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

## What you write (both platforms, for the same design)
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
2. **Do both platforms.** One design ⇒ implement the equivalent behavior in Android and iOS connector classes
   for the same controls/actions. Mirror the logic; account for each codebase's idioms.
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
The importer captures the native HTML event surface into each node's `interactions` (trigger → action). trigger/action are free-form strings; the recognized constants below are interpreted by both exporters. Authored events come from `<a href>`, `<form>`, and `on*` attributes — there is no other plain-HTML syntax for them.

**Triggers** (exact names): `CLICK` `DOUBLE_TAP` `LONG_PRESS` `MOUSE_DOWN` `MOUSE_UP` `CONTEXT_MENU` `HOVER` `HOVER_END` `SWIPE_UP` `SWIPE_DOWN` `SWIPE_LEFT` `SWIPE_RIGHT` `VALUE_CHANGE` `INPUT` `SUBMIT` `RESET` `FOCUS` `BLUR` `KEY_DOWN` `KEY_UP` `KEY_PRESS` `ON_LOAD` `SCROLL`.

**Actions** (exact names): `NAVIGATE_TO_STAGE` `OPEN_URL` `SUBMIT_FORM` `ANIMATE_PANEL` `TOGGLE_VISIBILITY` `PLAY_TIMELINE` `CALL_API` `CALL_DATABASE` `SET_STATE` `RUN_SCRIPT`.

**What runs on device with ZERO backend code** (both natives execute these in `GeneratedInteractions.perform`):
| Action | On-device behavior |
|---|---|
| `TOGGLE_VISIBILITY` | toggles the target view's visible/hidden |
| `ANIMATE_PANEL` | slides the target in from `params.fromSide` (`left`/`right`/`top`/`bottom`) over `params.duration` ms (default 300) |
| `NAVIGATE_TO_STAGE` | swaps to the target screen (iOS rebuilds + swaps the root; Android toggles the `nav_stage_<id>` container). `NuiBackend.onNavigateToStage(target)` ALSO fires for optional app logic. |

**Backend-routed — captured + gesture-bound but a NO-OP until your backend delegator/connector implements it** (these call a `NuiScreenDelegate` method whose default body is empty):
`CALL_API` → `onCallApi(target, params)` · `CALL_DATABASE` → `onCallDatabase(target, params)` · `PLAY_TIMELINE` → `onPlayTimeline(target, params)`.

**Captured but with NO runtime path at all** (no `perform` case AND no delegate hook — they round-trip in the model but do nothing on device; do the work yourself in a connector's `onScreenReady` via a typed control accessor): `OPEN_URL`, `SUBMIT_FORM`, `RUN_SCRIPT`, `SET_STATE`. Example: a `<form action=…>` becomes a `SUBMIT` trigger / `SUBMIT_FORM` action carrying `params.action`+`params.method`, but you must wire the submit button in a connector and POST yourself.

## `on*` handlers, `<a href>`, `<form>` — what import captures
- **`on*` attributes** become an interaction with `action=RUN_SCRIPT`. The JS body is **opaque** — it is NOT executed; it is stored verbatim in `params.handler` (truncated to 240 chars). Implement the real logic in a connector. Handler→trigger map (only the first handler per trigger wins): `onclick`→CLICK, `ondblclick`→DOUBLE_TAP, `oncontextmenu`→CONTEXT_MENU, `onmousedown`→MOUSE_DOWN, `onmouseup`→MOUSE_UP, `onmouseover`/`onmouseenter`→HOVER, `onmouseout`/`onmouseleave`→HOVER_END, `onchange`→**VALUE_CHANGE**, `oninput`→**INPUT** (distinct from change), `onsubmit`→SUBMIT, `onreset`→RESET, `onfocus`/`onfocusin`→FOCUS, `onblur`/`onfocusout`→BLUR, `onkeydown`→KEY_DOWN, `onkeyup`→KEY_UP, `onkeypress`→KEY_PRESS, `onscroll`→SCROLL, `onload`→ON_LOAD. Example: `<button onclick="save()">` → CLICK/RUN_SCRIPT with `params.handler="save()"` (you implement `save()` in a connector).
- **`<a href>`**: internal anchor (`#…`) → CLICK/`NAVIGATE_TO_STAGE`; external (`http://`,`https://`,`//`,`mailto:`,`tel:`) → CLICK/`OPEN_URL` with `params.href`. `href="#"` and `javascript:` hrefs are ignored.
- **`<form>`**: → SUBMIT/`SUBMIT_FORM` (carries `params.action`/`params.method`).
- **Note:** node-level `on*` capture is SKIPPED if the node already carries interactions from the model's own round-trip — authored interactions win.

## The known edge — renames/deletions
If the designer renames/deletes a node the backend uses, the typed accessor fails LOUDLY at runtime
(`IllegalStateException` / `fatalError` naming the missing id). Intended — no silent fallback. When you change
a node's id in the design, update connector references on both platforms.

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
  `api`/`database` library items. For **live runtime data**, connectors still own the fetch on both platforms;
  for fixed preview row pools, pass mapped rows to `controls.bindRepeater("<adapter-or-source-id>", rows)`.
  The helper updates templated text/prompt/accessibility fields and hides unused preview rows. Use custom
  `ListView` / `ComboBox` / app-owned views only when the design intentionally needs a different runtime
  surface.
- **Shared / navigation state** — `NAVIGATE_TO_STAGE` carries no payload. Pass data between screens through a
  connector/app-owned store: set it before navigating (or in `onNavigateToStage(target)`), read it in the
  destination screen's `onScreenReady`.
- **Persistence** — use the platform's storage from connectors: Android `SharedPreferences`/Jetpack
  `DataStore`/Room; iOS `UserDefaults`/files/a database. The contract imposes nothing here — it's ordinary
  app code. Mirror the same keys/shape on both platforms so the two apps behave identically.

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

## Accessibility — labels through connectors
The importer captures accessibility text from a **narrow** source, so most a11y labelling is your job in app code:
- **`<img alt="…">` IS imported** as the node's accessibility label (`accessibleText`) — exported to Android
  `android:contentDescription` and iOS `accessibilityLabel`. Always give meaningful images an `alt`.
- **`aria-*`, `role`, and `title` are NOT imported** (only the real `alt` survives; authored `data-*` are
  stripped on import and there is no aria/role mapping). So an icon-only button, an image-based control, or any
  non-image control with no visible text ships **without an accessibility label** unless you set one.
- **Label resolution (export):** the native label is the first non-blank of `accessibleText` (from `alt`) →
  the node's **visible text** → its **placeholder**. So a `<button>Save</button>` is already labelled "Save" and
  a placeholdered field is labelled by its placeholder — you only need to add labels where there's no visible
  text (icon buttons, image buttons, decorative-but-meaningful images without `alt`).
- **Set missing labels in connector `onScreenReady`** via the typed accessor, on both platforms:
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
