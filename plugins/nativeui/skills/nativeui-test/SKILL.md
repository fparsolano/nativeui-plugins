---
name: nativeui-test
description: >-
  Generate unit tests for an EXPORTED NativeUI app that assert the NuiBackend CONTRACT — the typed
  control accessors compile/resolve, onScreenReady is invoked, and the onCallApi / onNavigateToStage /
  onCallDatabase / onPlayTimeline delegate hooks are present — plus a basic smoke. Use after exporting
  a project to native (iOS XCTest + Android JUnit/Robolectric), or when the user asks to test / verify
  the contract between the generated UI and NuiBackend. Targets the GENERATED contract surface only —
  never tests or edits generated UI.
metadata:
  argument_hint: "[path to exported app / project.json]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-test` inside the installed plugin source before running commands.



# NativeUI generated-app contract tests

A NativeUI export draws a hard line (see `../nativeui/references/backend-contract.md`):

- **Generated UI** — `MainActivity` + layout / `App/MainViewController` + `NuiGenerated/Runtime/NuiViewFactory.swift`. Regenerated every export.
- **Contract** — `NuiScreenControls` (one typed accessor per designer-named node) + `NuiScreenDelegate`
  (`onScreenReady` + `onNavigateToStage` / `onCallApi` / `onCallDatabase` / `onPlayTimeline`). Regenerated every export.
- **Backend** — `NuiBackend.kt` / `NuiBackend.swift`. Yours; **never overwritten**.

These tests pin **that contract** so a future export (or a designer rename) that breaks the surface the
backend depends on fails loudly. They assert:

1. **Typed control accessors exist + compile + resolve.** `controls.<yourNodeId>` returns the live view.
   Accessor names are camelCased from the node id (`login_button` → `loginButton`); digit-first ids are
   prefixed `n` (`2col` → `n2col`); keyword collisions get a `View` suffix; duplicates are numbered.
   **Android caveat:** an id that does NOT start with a letter gets **no typed accessor** (only `view(id)`).
2. **`onScreenReady` is invoked** with a `NuiScreenControls` once the UI is built + bound.
3. **The four delegate hooks are present** + overridable (compile-time proof of the surface).
4. **A smoke** — the screen builds / the Activity launches and inflates the generated layout.

> Tests target the **generated contract surface** only. They never edit or assert pixel-level generated
> UI (that's the exporter's job, held at zero per-node deltas by the parity corpus). If a test needs to
> change generated UI to pass, that's wrong — fix the design + re-export, not the test.

## The fast path: generate the scaffolds

`bin/nui-test-gen.mjs` reads a `project.json`, derives the exact accessor names the exporter produced,
and writes ready-to-run test scaffolds into the exported app's test dirs:

```bash
# Android: src/test (Robolectric, JVM) + androidTest (instrumented smoke)
node <bin>/nui-test-gen.mjs project.json --platform android --out ./android-out

# iOS: a Tests/ XCTest source (+ a README on adding it to a Test target in Xcode)
node <bin>/nui-test-gen.mjs project.json --platform ios --out ./ios-out

# Both at once (separate output dirs):
node <bin>/nui-test-gen.mjs project.json --platform both \
  --out ./android-out --ios-out ./ios-out
```

It picks a representative **letter-first** named node to assert the typed accessor on (so the assertion
holds on both platforms) and always also asserts the untyped `view(id)` fallback. Pure Node, no network,
no auth.

### Wiring the generated tests into the build

- **Android** — the Robolectric unit test needs `testImplementation` deps in the app module's
  `build.gradle`: `org.robolectric:robolectric`, `androidx.test:core`, `junit:junit`. The instrumented
  smoke needs `androidx.test.ext:junit` + a connected device/emulator. Then `./gradlew testDebugUnitTest`
  (and `connectedDebugAndroidTest` for the smoke).
- **iOS** — in Xcode add a **Unit Testing Bundle** target to the app project, add
  `Tests/NuiBackendContractTests.swift` to it (it does `@testable import App`), then `Product > Test`
  (or `xcodebuild test -scheme <App>`). The generated `Tests/README.md` repeats this.

## Writing tests by hand (when the generator doesn't fit)

When you need bespoke assertions (a specific control's value, a wired action), WRITE them yourself off
these templates. Keep them on the contract surface.

### iOS XCTest (per app)

```swift
import XCTest
@testable import App

final class NuiBackendContractTests: XCTestCase {
    final class RecordingDelegate: NuiScreenDelegate {
        var ready = false; var captured: NuiScreenControls?
        func onScreenReady(_ c: NuiScreenControls) { ready = true; captured = c }
        func onNavigateToStage(_ t: String) {}
        func onCallApi(_ t: String, _ p: [String: String]) {}
        func onCallDatabase(_ t: String, _ p: [String: String]) {}
        func onPlayTimeline(_ t: String, _ p: [String: String]) {}
    }
    private func buildScreen() -> UIViewController {
        let vc = MainViewController(); vc.loadViewIfNeeded(); vc.view.layoutIfNeeded(); return vc
    }
    func testSmoke() {
        let vc = buildScreen()
        XCTAssertFalse(vc.view.subviews.isEmpty)
    }
    func testTypedAccessorsResolve() {
        // viewDidLoad already called NuiBackend.shared.onScreenReady; rebuild controls from the live root.
        let controls = NuiScreenControls(root: buildScreen().view)
        XCTAssertNotNil(controls.loginButton)            // typed accessor for id="login_button"
        XCTAssertNotNil(controls.view("login_button"))   // untyped fallback
    }
    func testDelegateSurface() {
        let d: NuiScreenDelegate = NuiBackend.shared
        d.onCallApi("login", [:]); d.onNavigateToStage("stage-1")
        d.onCallDatabase("users", [:]); d.onPlayTimeline("intro", [:])
    }
}
```

### Android JUnit / Robolectric (per app)

```kotlin
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NuiBackendContractTest {
    private class RecordingDelegate : NuiScreenDelegate {
        var ready = false; var captured: NuiScreenControls? = null
        override fun onScreenReady(controls: NuiScreenControls) { ready = true; captured = controls }
        override fun onCallApi(target: String, params: Map<String, String>) {}
        override fun onNavigateToStage(target: String) {}
        override fun onCallDatabase(target: String, params: Map<String, String>) {}
        override fun onPlayTimeline(target: String, params: Map<String, String>) {}
    }
    @Test fun smoke() = ActivityScenario.launch(MainActivity::class.java).use { s ->
        s.onActivity { a -> assertNotNull(a.findViewById<android.view.View>(android.R.id.content)) }
    }
    @Test fun typedAccessorsResolve() = ActivityScenario.launch(MainActivity::class.java).use { s ->
        s.onActivity { a ->
            // MainActivity.onCreate already called NuiBackend.onScreenReady(NuiScreenControls(this)).
            val controls = NuiScreenControls(a)
            assertNotNull(controls.loginButton)          // typed accessor for id="login_button"
            assertNotNull(controls.view("login_button")) // untyped fallback
        }
    }
    @Test fun delegateSurface() {
        val d: NuiScreenDelegate = RecordingDelegate()
        d.onCallApi("login", emptyMap()); d.onNavigateToStage("stage-1")
        d.onCallDatabase("users", emptyMap()); d.onPlayTimeline("intro", emptyMap())
        // GeneratedInteractions.* routing lambdas are assignable (default to NuiBackend.*).
        GeneratedInteractions.onCallApi = { _, _ -> }
    }
}
```

## Lifecycle notes that make these tests correct

- **`onScreenReady` is called DIRECTLY, not through a swappable delegate.** Android:
  `MainActivity.onCreate` → inflate → `GeneratedInteractions.bind(this)` →
  `NuiBackend.onScreenReady(NuiScreenControls(this))`. iOS: `viewDidLoad` → build root →
  `GeneratedInteractions.shared.delegate = NuiBackend.shared` → `NuiBackend.shared.onScreenReady(...)`.
  So to assert the hand-off, **rebuild `NuiScreenControls` from the launched screen** (as above) rather
  than expecting your own delegate's `onScreenReady` to fire.
- **Authored events DO route through the delegate** (`GeneratedInteractions` lambdas default to
  `NuiBackend.*`) — those lambdas are assignable for tests/harnesses.
- A renamed/deleted node makes the typed accessor trap (`IllegalStateException` / `fatalError`) — that is
  the intended failure the accessor test pins.

The authoritative contract + the gate that enforces it (`NativeBackendContractExportTest`) live in
`../nativeui/references/backend-contract.md` and `docs/native-backend-contract.md`.
