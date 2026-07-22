# Deploy the NativeUI backend server

Four recipes for the server your exported app talks to. The **server** is your own — the NativeUI
exporter never generates or hosts it. These recipes assume you have a runnable server scaffold from
`../<stack>/` (Node/Hono `../node-hono`, Python/FastAPI `../python-fastapi`, BaaS `../baas`, or Mock
`../mock-local`) exposing at minimum:

- `GET /health` → `200 {"ok":true}` (the deploy targets health-check this)
- CORS allowing your app's origin (env `ALLOWED_ORIGINS`)
- a port from env `PORT` (every target injects `PORT`; never hardcode)
- the derived endpoint shape, e.g. `POST /api/<target>` — one route per authored `CALL_API` target,
  `POST /db/<target>` per `CALL_DATABASE` target (see `../node-hono/README.md`)

| Recipe | Best for | Long-running? | Python? |
|---|---|---|---|
| [`cloud-run/`](cloud-run/) — **default** | container, scale-to-zero, matches NativeUI infra (gcloud installed) | yes | yes |
| [`fly-railway-render/`](fly-railway-render/) | container, always-on or scale-to-zero, simplest UX | yes | yes |
| [`vercel-netlify/`](vercel-netlify/) | Node/Hono **serverless** only | no (short requests) | no |
| [`docker-vps/`](docker-vps/) | full control on your own VM, TLS via Caddy/nginx | yes | yes |

Pick **one**. All four take the same Dockerfile shape except `vercel-netlify/`, which is serverless.

---

## The last step is ALWAYS the same: point the app at the deployed URL

Every recipe below ends here. **Do it after the server is live and `GET https://<your-url>/health`
returns `200`.**

### What the exporter does and does NOT emit (verify before trusting)
Every selected target declares its durable action/data seams in `nativeui-export-manifest.json`; networking and
base-URL config belong there or in app-owned shared config, never generated UI. The flagship iOS/Android pair
uses `NuiScreenControls`/`NuiScreenDelegate`, app-owned `*BackendConnector.{kt,swift}`, and thin
`NuiBackend.{kt,swift}` delegators. Rust, C#, and authored web lanes use their own manifest-declared seams. The
exporters do **not** invent production origins or secret values, so "flipping the base URL" means editing a
target-appropriate constant/config source **you** own.

### 1. Define one env-switched base-URL/config source per selected target
The following Kotlin/Swift snippets apply only when the flagship mobile pair is selected:
```kotlin
// Android — BackendConfig.kt or a *BackendConnector.kt  (BuildConfig keeps the value out of source)
private val API_BASE = BuildConfig.API_BASE_URL   // dev: http://10.0.2.2:8787  prod: https://api.yourapp.com
```
```swift
// iOS — BackendConfig.swift or a *BackendConnector.swift  (read from .xcconfig/Info.plist, or #if DEBUG)
#if DEBUG
private let apiBase = "http://localhost:8787"
#else
private let apiBase = "https://api.yourapp.com"
#endif
```
Use `API_BASE` in every connector `onCallApi`/`onCallDatabase` request. There is exactly one place to change.

### 2. Dev base URL reminders (why localhost differs per platform)
- **iOS Simulator** reaches your Mac's localhost directly: `http://localhost:8787`.
- **Android emulator** cannot see `localhost` (that's the emulator). Use **`http://10.0.2.2:8787`**
  (the host-loopback alias). A physical device uses your machine's LAN IP.

### 3. Plaintext HTTP in dev needs an explicit opt-in on the flagship mobile pair
When that pair is selected, the exporters emit no HTTP allowance and modern iOS/Android block cleartext by
default. For a
`http://` **dev** server you must add (remove for prod, which is HTTPS-only):
- **Android** — the manifest the exporter writes has no `INTERNET` permission and no
  `usesCleartextTraffic`. To call any network at all add the permission; to call `http://` add a
  cleartext opt-in. Prefer a scoped `network_security_config.xml` (dev hosts only) over a blanket flag:
  ```xml
  <!-- AndroidManifest.xml -->
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:networkSecurityConfig="@xml/network_security_config" ...>
  ```
  ```xml
  <!-- res/xml/network_security_config.xml -->
  <network-security-config>
    <domain-config cleartextTrafficPermitted="true">
      <domain includeSubdomains="true">10.0.2.2</domain>
      <domain includeSubdomains="true">localhost</domain>
    </domain-config>
  </network-security-config>
  ```
- **iOS** — the exporter's Info.plist has no `NSAppTransportSecurity`. For an `http://` dev server add
  a scoped ATS exception (NOT a blanket `NSAllowsArbitraryLoads`):
  ```xml
  <key>NSAppTransportSecurity</key>
  <dict><key>NSExceptionDomains</key><dict>
    <key>localhost</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
  </dict></dict>
  ```

**Production is HTTPS** (every recipe gives you a TLS URL), so the prod build needs neither the
cleartext opt-in nor the ATS exception — gate them to DEBUG/dev so they never ship.

> Full base-URL wiring details (with the regeneration caveats for `Info.plist`/`AndroidManifest`) live in
> the skill reference `../../references/backend-deployment.md`.
