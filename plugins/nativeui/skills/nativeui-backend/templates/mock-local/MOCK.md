# Mock / local-first backend — run the app with NO server

Two ways to make an exported NativeUI app behave **without standing up a real backend**, in increasing
fidelity. The Kotlin/Swift implementations below are **flagship-mobile examples**. For Rust, C#, or authored
web, put equivalent behavior in that selected target's manifest-declared durable seam. Nothing here touches
a generated UI file. The whole vocabulary (which actions reach a
delegate hook, which are no-ops) is in `../../../nativeui/references/backend-contract.md`.

| Path | Fidelity | When |
|---|---|---|
| **A. Canned data in a connector** | no network at all | fastest loop; demo offline; no deploy story yet |
| **B. Local mock HTTP server** | real `URLSession`/`HttpURLConnection` round-trip on `localhost` | exercise your *real* networking code + JSON parsing before a real backend exists |

A designer-authored `CALL_API` lands in `onCallApi(target, params)` and a `CALL_DATABASE` in
`onCallDatabase(target, params)` (the two hooks are scaffolded empty — see the contract reference). `target` is
the interaction's target id (a `libraryItems[]` `api`/`database` item, or the authored name); `params` carries
the authored arguments. **You** decide what those return — in mock mode, canned data.

> If your screen has **no** authored `CALL_API`/`CALL_DATABASE` interaction, there's no hook to fill — do your
> mock data-loading directly in `onScreenReady(controls)` by writing into the typed control accessors
> (`controls.tripTitle.text = …`). `onScreenReady` is the consistent population point on both platforms
> (the `ON_LOAD` ordering caveat in the contract reference does not affect it).

---

## Path A — canned data inside a connector (zero network)

Return a hardcoded object straight from the hook and update controls from it. No HTTP, no permissions, no
threads. The hooks have **empty defaults** in the generated `NuiScreenDelegate`; you override only what you use.

### Android — `TripBackendConnector.kt`
```kotlin
package com.example.app   // keep the package the scaffold emitted

// YOURS — app-owned, durable across UI re-imports/regens.
class TripBackendConnector : NuiScreenDelegate {

    // Hold the controls so a hook can update the UI after "loading" mock data.
    private var controls: NuiScreenControls? = null

    override fun onScreenReady(controls: NuiScreenControls) {
        this.controls = controls
    }

    // Designer-authored CALL_API lands here. In mock mode we ignore the network
    // and return canned data synchronously, routing by `target`.
    override fun onCallApi(target: String, params: Map<String, String>) {
        val data: Map<String, Any> = when (target) {
            "get_trips" -> mapOf(
                "trips" to listOf(
                    mapOf("id" to "rome",   "title" to "Rome",   "price" to 1280),
                    mapOf("id" to "lisbon", "title" to "Lisbon", "price" to 740),
                )
            )
            "get_profile" -> mapOf("name" to "Dev User", "email" to params["email"].orEmpty())
            else -> mapOf("ok" to true, "target" to target, "params" to params)
        }
        applyMock(target, data)
    }

    override fun onCallDatabase(target: String, params: Map<String, String>) {
        // e.g. a SUBMIT_FORM you wired to CALL_DATABASE — pretend it persisted.
        applyMock(target, mapOf("ok" to true, "id" to "mock-1"))
    }

    // Push canned data into the typed accessors. Names come from your node ids,
    // camelCased (e.g. id "trip_title" -> controls.tripTitle). Update on the main thread.
    private fun applyMock(target: String, data: Map<String, Any>) {
        val c = controls ?: return
        if (target == "get_trips") {
            val first = (data["trips"] as? List<*>)?.firstOrNull() as? Map<*, *> ?: return
            c.tripTitle.text = first["title"]?.toString() ?: ""   // a Label named trip_title
        }
    }
}
```

Keep `NuiBackend.kt` as a tiny registration/delegation file:
```kotlin
object NuiBackend : NuiScreenDelegate by TripBackendConnector()
```

### iOS — `App/TripBackendConnector.swift`
```swift
import UIKit

// YOURS — app-owned, durable across UI re-imports/regens.
final class TripBackendConnector: NuiScreenDelegate {
    private weak var controls: NuiScreenControls?

    func onScreenReady(_ controls: NuiScreenControls) {
        self.controls = controls
    }

    // Designer-authored CALL_API lands here. Return canned data, route by `target`.
    // (NuiScreenDelegate supplies empty defaults, so no `override` keyword.)
    func onCallApi(_ target: String, params: [String: String]) {
        let data: [String: Any]
        switch target {
        case "get_trips":
            data = ["trips": [
                ["id": "rome",   "title": "Rome",   "price": 1280],
                ["id": "lisbon", "title": "Lisbon", "price": 740],
            ]]
        case "get_profile":
            data = ["name": "Dev User", "email": params["email"] ?? ""]
        default:
            data = ["ok": true, "target": target, "params": params]
        }
        applyMock(target, data)
    }

    func onCallDatabase(_ target: String, params: [String: String]) {
        applyMock(target, ["ok": true, "id": "mock-1"])
    }

    // Push canned data into the typed accessors (id "trip_title" -> controls.tripTitle).
    private func applyMock(_ target: String, _ data: [String: Any]) {
        guard let c = controls else { return }
        if target == "get_trips",
           let first = (data["trips"] as? [[String: Any]])?.first {
            c.tripTitle.text = first["title"] as? String ?? ""   // a UILabel named trip_title
        }
    }
}
```

Keep `NuiBackend.swift` as a tiny registration/delegation file:
```swift
final class NuiBackend: NuiScreenDelegate {
    static let shared = NuiBackend()
    private let connector = TripBackendConnector()

    func onScreenReady(_ controls: NuiScreenControls) { connector.onScreenReady(controls) }
    func onCallApi(_ target: String, params: [String: String]) { connector.onCallApi(target, params: params) }
    func onCallDatabase(_ target: String, params: [String: String]) { connector.onCallDatabase(target, params: params) }
}
```

**Notes**
- `controls.tripTitle` is the **typed accessor** the flagship generated `NuiScreenControls` exposes for a node whose
  `id` is `trip_title` (accessor = id camelCased). Renaming/deleting that node makes the accessor fail loudly
  at runtime by design — update every selected target seam when an id changes.
- Keep every selected target **behaviorally mirrored** — same `target` cases and canned shapes. If the flagship
  mobile pair is selected, that includes both Android and iOS; do not create either when it was not selected.
- This path uses **no network**, so the network-permission section below does **not** apply to it.

---

## Path B — tiny local mock HTTP server (real round-trip)

Use this when you want your **actual** networking code (`URLSession` / `HttpURLConnection`, your JSON decoder)
to run against a real endpoint before a backend exists. `mock-server.mjs` (next to this file) is a single
zero-dependency Node file — no `npm install`.

### Run it
```bash
node mock-server.mjs            # http://localhost:8787
PORT=4000 node mock-server.mjs  # or pick a port (also: --port 4000)
curl http://localhost:8787/health            # {"status":"ok"}
curl http://localhost:8787/api/get_trips     # canned trips
```
It answers two path families that mirror how a connector typically derives a URL from a `CALL_API` /
`CALL_DATABASE` target:
- `CALL_API`     → `GET|POST /api/<target>`
- `CALL_DATABASE`→ `POST /db/<target>`

Unknown paths return a generic `{ "ok": true, … }` (nothing 404s while you prototype); POST bodies are echoed
back under `received` so you can confirm `params` reached the server. **Customize responses** by creating
`fixtures.json` next to the server, keyed by `"<METHOD> <path>"` (a `"*"` method matches any verb); the file
hot-reloads on save:
```json
{
  "GET /api/get_trips": { "trips": [{ "id": "tokyo", "title": "Tokyo", "price": 1450 }] },
  "POST /api/login":     { "sessionId": "mock-session", "user": { "id": "u1" } },
  "* /db/save_note":     { "ok": true, "id": "note-42" }
}
```

### Point the connector at it — the base-URL host differs per target
The app and the server run on **different hosts**, so `localhost` from the app does **not** reach your Mac:
- **iOS Simulator** shares the Mac's network → use `http://localhost:8787` (or `http://127.0.0.1:8787`).
- **Android emulator** reaches the host machine at the special alias **`http://10.0.2.2:8787`** (NOT
  `localhost`, which is the emulator itself).
- **A physical device** → use your Mac's LAN IP (e.g. `http://192.168.1.x:8787`) and keep both on the same
  Wi-Fi.

Minimal real-network hook (replace the canned bodies from Path A with a fetch inside the connector):
```kotlin
// Android — TripBackendConnector.kt (inside onCallApi); 10.0.2.2 = host machine from the emulator
override fun onCallApi(target: String, params: Map<String, String>) {
    Thread {                                   // never network on the main thread
        val url = java.net.URL("http://10.0.2.2:8787/api/$target")
        val json = url.openStream().bufferedReader().use { it.readText() }
        runOnMain { /* parse `json`, update controls.* */ }
    }.start()
}
```
```swift
// iOS — App/TripBackendConnector.swift (inside onCallApi); localhost works from the Simulator
func onCallApi(_ target: String, params: [String: String]) {
    let url = URL(string: "http://localhost:8787/api/\(target)")!
    URLSession.shared.dataTask(with: url) { data, _, _ in
        guard let data else { return }
        DispatchQueue.main.async { /* parse `data`, update controls.* */ }
    }.resume()
}
```
> The `<target>` ↔ endpoint mapping is **yours**. If the design promoted the endpoint into a `libraryItems[]`
> `api` item, its `configJson` (`{ baseUrl, path, method, headers, … }`) is also surfaced to your code in the
> generated library catalog (Android `GeneratedLibraryCatalog`, iOS `GeneratedLibraryCatalog.find(id:)`) —
> you can read `baseUrl`/`path` from there instead of hardcoding, but for a local mock the literal host above
> is simpler.

### Network-permission gotchas — the generated projects ship locked down for HTTP
A local mock is **plaintext HTTP**, and the exported projects do **not** enable cleartext or grant network
access out of the box, so a `localhost`/`10.0.2.2` call will fail until you add the following **to the
exported native project** (these are app-config files, not generated NUI files — safe to edit):

- **Android** — the generated `AndroidManifest.xml` has **no** `INTERNET` permission and **no** cleartext
  opt-in. Add both (debug only):
  ```xml
  <manifest …>
      <uses-permission android:name="android.permission.INTERNET" />
      <application … android:usesCleartextTraffic="true">   <!-- DEBUG ONLY; remove for release -->
          …
      </application>
  </manifest>
  ```
  (Cleaner: a `res/xml/network_security_config.xml` that allows cleartext for `10.0.2.2` + `localhost`
  only, referenced via `android:networkSecurityConfig`.)
- **iOS** — the generated `Info.plist` has **no** App Transport Security exception, so non-HTTPS is blocked.
  Add a localhost exception (debug only):
  ```xml
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSExceptionDomains</key>
    <dict>
      <key>localhost</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key><true/>
      </dict>
    </dict>
  </dict>
  ```
  (`127.0.0.1` is exempt from ATS without configuration; the named `localhost` domain still needs the
  exception above.)

**Remove every cleartext/ATS relaxation before shipping** — they exist only so the local mock works. The real
backend is HTTPS, which needs none of this. Never hardcode secrets in connector or delegator code either way
(see the contract reference → Secrets); a mock needs none.

---

## Graduating off the mock
When you stand up a real backend (a Node/Python/BaaS scaffold, or the dev.nativeui.com conventions), change
only the **base URL** the hook builds — keep the `target` routing and JSON shapes identical, point at HTTPS,
and delete the cleartext/ATS exceptions above. The connector structure you wrote against the mock is the
same structure the real backend uses.
