# Backend deployment — wire the app to the server, then deploy the server

Reference for the `nativeui-backend` skill, used AFTER it has scaffolded a server (`../templates/<stack>/`).
Two parts: **(1) Wire the base URL** — point connector classes at the running server and add the
per-platform network config a dev `http://` URL needs; **(2) the deploy-target matrix** — pick a host and
follow its recipe under `../templates/deploy/`. It assumes the on-device vocabulary in
`../../nativeui/references/backend-contract.md` (the `CALL_API`/`CALL_DATABASE` actions, the
`onCallApi`/`onCallDatabase` hooks) is already understood.

## Wiring the app to your backend (base URL + per-platform network config)

Once the server is running (locally or deployed), the exported app needs three things: a **base URL**, the
network code that hits it (in connector methods reached from `onCallApi` / `onCallDatabase`), and — for
plain-`http://` dev URLs only — a **per-platform security exception**. The app's request code lives in
app-owned backend files: connector classes plus thin `NuiBackend.*` delegation; never edit generated files.

> Confirmed against the exporters (`IosProjectExporter.java`, `AndroidProjectExporter.java`) on this repo:
> the clean/PROD export emits a minimal `Info.plist` with **no `NSAppTransportSecurity` key**, and a minimal
> `AndroidManifest.xml` / `build.gradle.kts` with **no `usesCleartextTraffic`, no `networkSecurityConfig`, no
> `INTERNET` permission, and no `buildConfigField`/`buildFeatures.buildConfig`**. So every snippet below is
> something the user **adds** — nothing here conflicts with what the exporter already writes.

### 1. Where the base URL lives

Keep it in app-owned backend code that re-export never overwrites, preferably a connector/shared backend config
referenced by connector classes. Don't try to thread it through generated `BuildConfig`/`Info.plist` first —
those files (`build.gradle.kts`, `Info.plist`, `AndroidManifest.xml`, `MainActivity.kt`) are **regenerated on
every export**, so any constant you add there is lost on the next `nui-export`. A constant in connector classes
or thin `NuiBackend.{swift,kt}` delegation survives because those app-owned files are not rewritten.

Pick the URL by build config so dev and prod diverge automatically:

**iOS — in `App/<Feature>BackendConnector.swift` or shared backend config:**
```swift
private enum Backend {
    static var baseURL: URL {
        #if DEBUG
        // Simulator shares the Mac's network, so localhost == your machine.
        return URL(string: "http://localhost:8080")!
        #else
        return URL(string: "https://api.yourdomain.com")!
        #endif
    }
}
```
*(On a **physical iPhone**, `localhost` is the phone, not your Mac — use the Mac's LAN IP, e.g.
`http://192.168.1.42:8080`, and add an ATS exception for that host as in §3.)*

**Android — in `<Feature>BackendConnector.kt` or shared backend config:**
```kotlin
private object Backend {
    // 10.0.2.2 is the Android emulator's alias for the host machine's loopback (your dev box's
    // localhost). A physical device on the same Wi-Fi uses the host's LAN IP instead.
    val baseUrl: String =
        if (BuildConfig.DEBUG) "http://10.0.2.2:8080"
        else "https://api.yourdomain.com"
}
```
`BuildConfig.DEBUG` is provided by AGP for every module with no extra setup (it does **not** require
`buildFeatures.buildConfig = true`; that flag only gates *custom* `buildConfigField`s). If you'd rather not
depend on it, hard-code one URL or branch on your own constant.

### 2. How `onCallApi` / `onCallDatabase` use it

These are the delegate hooks the generated interaction layer routes a `CALL_API` / `CALL_DATABASE` action
into (`target` = the authored api/database `libraryItems[]` id or name; `params` = the authored arguments —
typed `[String: String]` on iOS, `Map<String, String>` on Android). The derived endpoint shape is
**`{baseURL}/api/{target}`** with `params` as the JSON body — match whatever path convention your scaffolded
server exposes (the server scaffold in this skill derives one route per authored api/db target).

**iOS — in a connector class:**
```swift
func onCallApi(_ target: String, _ params: [String: String]) {
    var req = URLRequest(url: Backend.baseURL.appendingPathComponent("api/\(target)"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: params)
    URLSession.shared.dataTask(with: req) { data, _, error in
        guard let data = data, error == nil else { return }
        // Decode, then hop to the main thread before touching any control:
        DispatchQueue.main.async { /* update controls captured in onScreenReady */ }
    }.resume()
}
```

**Android — in a connector class** (uses only the JDK's `HttpURLConnection`; the scaffold pulls in no HTTP
library, so either use this or add OkHttp/Retrofit to `app/build.gradle.kts` yourself):
```kotlin
override fun onCallApi(target: String, params: Map<String, String>) {
    Thread {
        runCatching {
            val url = java.net.URL("${Backend.baseUrl}/api/$target")
            (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(org.json.JSONObject(params).toString().toByteArray()) }
                val body = inputStream.bufferedReader().readText()
                // Hop to the UI thread before touching any control:
                // android.os.Handler(android.os.Looper.getMainLooper()).post { /* update controls */ }
            }
        }
    }.start()
}
```
`onCallDatabase` mirrors this against your DB route (e.g. `db/$target`). Capture the controls you'll update
in `onScreenReady(controls)` and write to them on the main/UI thread.

**Required: declare the `INTERNET` permission (Android).** The generated `AndroidManifest.xml` does not
request it. Add it inside your own copy — but since the manifest is regenerated, the durable move is to put
it in a **manifest you don't let the exporter own** (see §3's `network_security_config` note for the same
regeneration caveat). Minimal addition, just inside `<manifest>` before `<application>`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```
(iOS needs no permission entry for outbound HTTP.)

### 3. Plain-`http://` dev URLs need a security exception

Both platforms block cleartext (`http://`) traffic by default. Production HTTPS URLs need **nothing** below —
these exceptions are **dev-only**, for talking to `localhost` / `10.0.2.2` / a LAN IP over `http`.

#### iOS — App Transport Security (Info.plist)

The exported `Info.plist` is generated with **no `NSAppTransportSecurity` key**, which means full ATS is in
force and `http://localhost` is blocked. Because the exporter **regenerates `Info.plist` on every export**,
don't hand-edit the generated one expecting it to stick — add the exception in **your own working copy of the
iOS project** (or keep it in a project-level `.xcconfig` / a not-regenerated overlay). Scope it as tightly as
possible — exempt only `localhost`, not the whole app:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>localhost</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```
For a physical device hitting your Mac by LAN IP, add that IP as a second key under `NSExceptionDomains` with
the same `NSExceptionAllowsInsecureHTTPLoads` child. **Avoid `NSAllowsArbitraryLoads`** (it disables ATS app-
wide and trips App Store review); the per-domain exception above is the correct, reviewable form. Strip the
entire `NSAppTransportSecurity` dict before shipping a release that talks to an HTTPS prod URL.

#### Android — cleartext for the emulator host

`10.0.2.2` is the **Android emulator's special alias for the host machine's loopback** — i.e. your dev box's
`localhost` as seen from inside the emulator (a physical device can't use it; use the host's LAN IP on shared
Wi-Fi). Since Android 9 (API 28 — which is exactly this export's `minSdk`), cleartext HTTP is **off by
default**, so a request to `http://10.0.2.2:8080` fails with a cleartext-not-permitted error until you opt in.

The generated `AndroidManifest.xml` sets **neither** `usesCleartextTraffic` **nor** `networkSecurityConfig`,
so add one. Prefer a **scoped network-security config** (cleartext only for the dev host) over the blunt
manifest flag.

**Scoped (recommended)** — `app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```
Reference it from the `<application>` tag:
```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ... >
```
**Blunt alternative** (allows cleartext to *any* host — fine for a throwaway dev build, not for release):
```xml
<application android:usesCleartextTraffic="true" ... >
```
**Regeneration caveat:** the exporter rewrites `AndroidManifest.xml` on every export, so a hand-edit to the
generated manifest is lost on re-export — keep the manifest change (and the `INTERNET` permission and the
`networkSecurityConfig` attribute) in your own non-regenerated app shell, or re-apply them after each export.
The `res/xml/network_security_config.xml` file itself is **not** something the exporter emits, so it survives
untouched; only the manifest attribute pointing at it has to be re-added. A release build over HTTPS needs
neither the config nor the flag — remove both before shipping.

### 4. Web static and SSR clients

The five authored web lanes use preserved `app-actions`, `data-adapters`, and `custom-components` seams; UI
events are compiled directly into the generated framework, not interpreted from a shipped NativeUI model.
`Static` below means prerendered assets and static hosting, not static behavior or a reduced capability set;
responsive layout, routes, interactions, state, forms/lists, timelines, and offline behavior remain compiled.

- **Static:** browser code needs a public HTTPS API origin (or a provider rewrite/proxy). Configure exact
  production CORS origins and decide whether auth uses bearer headers or cookies. Cross-site cookies require an
  explicit credentials policy plus appropriate `SameSite` and `Secure` settings.
- **SSR:** React, Vue, Angular, and Astro can call private upstreams or same-origin proxy routes from server code.
  Server-only environment variables must never enter client bundles. Hydrated/browser actions still use a
  public or same-origin proxy endpoint. Vanilla HTML is static-only.
- Keep local/dev/preview/prod frontend and API origins in environment/build configuration, not generated UI or
  project JSON. Verify both a direct clean route and client navigation against the intended base path.
- The PWA service worker may cache versioned client assets and offline navigation fallback. It must never cache
  API, authentication, POST, or user-specific responses.

Frontend deployment is distinct from the backend host selected below. Confirm the generated lane's actual
static output or Node start command and provider adapter/config before promising deployment.

### 5. Quick checklist

| | dev (`http://localhost` / `http://10.0.2.2`) | prod (`https://…`) |
|---|---|---|
| Base URL in connector/shared backend config | yes (`#if DEBUG` / `BuildConfig.DEBUG`) | yes |
| iOS ATS exception (Info.plist) | **required** (scoped `NSExceptionDomains`) | not needed |
| Android cleartext (manifest / xml) | **required** (scoped `network_security_config`) | not needed |
| Android `INTERNET` permission | required | required |
| Survives re-export? | connector/shared backend config + `res/xml/*` do — re-apply manifest/Info.plist edits | same |

---

## Deploy-target matrix

Pick ONE host for the scaffolded server. Each recipe lives under `../templates/deploy/<dir>/` with its own
`DEPLOY.md`. Offer only the targets whose CLI is installed (the plan tool detects this), with the one-line
tradeoff:

| Target | Template dir | Best for | Long-running? | Python? |
|---|---|---|---|---|
| **Cloud Run** *(default)* | `deploy/cloud-run/` | container, scale-to-zero, matches NativeUI infra (`gcloud`) | yes | yes |
| **Fly.io / Railway / Render** | `deploy/fly-railway-render/` | container PaaS, minimal config, good free-ish tiers | yes | yes |
| **Vercel / Netlify** | `deploy/vercel-netlify/` | Node/Hono **serverless** functions + BaaS edge functions | no (short requests) | no |
| **Docker-on-VPS** | `deploy/docker-vps/` | full control on a box you own, TLS via Caddy/nginx | yes | yes |

What every server scaffold must expose so any target works:
- `GET /health` → `200 {"ok":true}` (targets health-check this).
- Binds **`process.env.PORT`** (every target injects `PORT`; never hardcode).
- CORS from env `ALLOWED_ORIGINS` (native apps send no `Origin`, so this gates browser callers only).
- The derived endpoint shape — one route per authored `CALL_API`/`CALL_DATABASE` target.

**Secrets** are always env vars / the target's secret store (Secret Manager, `fly secrets`, Vercel/Netlify
env, a git-ignored `.env` on a VPS) — never committed, never baked into an image, never in the app (it's
decompilable; see `../../nativeui/references/backend-contract.md` → Secrets). **BaaS (Supabase/Firebase) and
Mock/local-first skip this step:** a BaaS is hosted by the provider (deploy nothing, or only a thin proxy via
`deploy/cloud-run/`), and the Mock server is local-only.

Every recipe ends the same way: once `GET https://<your-url>/health` is green, update the **prod** value of the
single base-URL/config source owned by each selected target's manifest-declared durable seam. For the flagship
mobile pair this normally lives in app-owned Kotlin/Swift connector config; Rust, C#, and web use their declared action/data seams instead. Drop target-specific dev cleartext/ATS exceptions from release builds (prod is HTTPS).
