# Supabase backend for your NativeUI app

**Least-server-code path #1.** Supabase gives you a hosted **Postgres** database, **Auth**, and an
auto-generated **REST + realtime** API — no server to write or deploy. Your exported app talks to it
straight from app-owned `*BackendConnector.{kt,swift}` classes, with `NuiBackend.{kt,swift}` kept as thin
delegators. You write *zero* backend HTTP code; you just call Supabase from the device.

> Where this fits: NativeUI generates the UI and routes designer-authored events to delegate hooks
> (`onCallApi`, `onCallDatabase`, `onScreenReady`). Supabase is what those hooks talk to. Nothing here
> touches a generated file — see `../../../../nativeui/references/backend-contract.md`.

## 1. Create the project
1. Go to <https://supabase.com> → **New project**. Pick a name, a strong DB password, a region near your users.
2. Wait for it to provision (~2 min).

## 2. Run the schema
1. Open the project → **SQL Editor** → **New query**.
2. Paste the contents of [`schema.sql`](./schema.sql) → **Run**.
3. It creates `profiles` + `items`, enables **Row Level Security**, and adds owner-scoped policies.
   **Edit `schema.sql` first** to match your real screens (rename `items`, add columns), then re-run.
   RLS is the load-bearing part: it makes the anon key safe to ship (a user only ever sees their own rows).

## 3. Get the URL + anon key
**Project Settings → API**:
- **Project URL** — `https://<ref>.supabase.co`
- **anon public key** — a long JWT. This is **publishable** — it's *meant* to ship in a client, and RLS is
  what protects your data. (The **service_role** key is a secret and must **never** go in the app.)

## 4. Where they go in the app — connector config, never a generated file
The URL + anon key are **non-secret config**, so they can live in the app — but keep them out of source
control and out of any generated file. Inject them via the build, read them from connector/shared backend
config:

- **Android** — add to `local.properties` (git-ignored), surface as `BuildConfig` fields in
  `app/build.gradle.kts`:
  ```kotlin
  // app/build.gradle.kts → android { defaultConfig { ... } }
  buildConfigField("String", "SUPABASE_URL", "\"${project.findProperty("SUPABASE_URL") ?: ""}\"")
  buildConfigField("String", "SUPABASE_ANON_KEY", "\"${project.findProperty("SUPABASE_ANON_KEY") ?: ""}\"")
  ```
  Read `BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_ANON_KEY` from a `*BackendConnector.kt` or
  shared backend config object.
- **iOS** — put them in an `.xcconfig` (git-ignored) and surface via `Info.plist` build-setting
  substitution, or read from a config struct; reference them from a `*BackendConnector.swift`. The
  exported clean `Info.plist` lives at `App/Info.plist`.

> **Network access is NOT auto-configured by the exporter.** The generated `AndroidManifest.xml` has **no
> `INTERNET` permission** and the clean `Info.plist` has **no `NSAppTransportSecurity` block**. Supabase is
> HTTPS so iOS ATS is satisfied by default, but Android still needs the permission. Add to the exported
> `app/src/main/AndroidManifest.xml` (a manifest-merge file you may add — it is not regenerated like the
> Kotlin UI):
> ```xml
> <uses-permission android:name="android.permission.INTERNET" />
> ```
> (Only add `android:usesCleartextTraffic="true"` / an ATS exception if you point at a plain-`http://` dev
> instance — never for production HTTPS.)

## 5. How a designer-authored action maps to a Supabase call
A designer wires events in the design (a tapped button → "call database X", a form submit, an `ON_LOAD`
fetch). On import these become `interactions` with an `action` and a `target`, and may promote a
`libraryItems[]` entry (`assetType: "database"` or `"api"`) that names the endpoint. At runtime the
native routes them to a delegate hook whose **default body is empty** — you implement the hook:

| Designer action | Delegate hook you implement | What you do with Supabase |
|---|---|---|
| `CALL_DATABASE` | `onCallDatabase(target, params)` | run a table query / insert / update |
| `CALL_API` | `onCallApi(target, params)` | call a Supabase **Edge Function** or any REST endpoint |
| `SUBMIT_FORM` | *(no hook)* — wire the submit button in connector `onScreenReady` | read the form controls, insert a row |

`target` is the interaction's target id (the `libraryItems[]` database/api item id, or the authored name);
`params` is the authored `Map<String,String>`. `switch`/`when` on `target`, one branch per authored action.

### Database config the designer can attach (`libraryItems[].configJson`)
A `database` library item stores **non-secret** connection fields in `configJson`:
`connectorId, host, port, databaseName, jdbcUrl, username, testQuery` (the password is held server-side as a
`secretRef`, never in `configJson`). The built-in connectors are JDBC-style
(`postgresql, mysql, mariadb, sqlserver, oracle, sqlite, generic`) — **there is no "supabase" connector**.
So treat the `database` item as *documentation of intent* (which table/op the designer meant) and reach
Supabase from the device the idiomatic way below. (You *can* point a `postgresql` connector at Supabase's
direct Postgres host, but that's a server-to-server pattern, not a device-side one — prefer supabase-js/REST.)

### Two device-side ways to call Supabase

**A. supabase-js / native SDK (recommended).** Add the SDK and call it in the hook. Conceptually:
```kotlin
// Android — ItemsBackendConnector.kt (sketch; using the supabase-kt client)
override fun onCallDatabase(target: String, params: Map<String, String>) {
    when (target) {
        "load_items" -> scope.launch {
            val rows = supabase.from("items").select().decodeList<Item>()  // RLS scopes to this user
            withContext(Dispatchers.Main) { /* write rows into controls.* */ }
        }
    }
}
```
```swift
// iOS — ItemsBackendConnector.swift (sketch; using supabase-swift)
func onCallDatabase(_ target: String, _ params: [String: String]) {
    guard target == "load_items" else { return }
    Task {
        let rows: [Item] = try await supabase.from("items").select().execute().value
        await MainActor.run { /* write rows into controls.* */ }
    }
}
```

**B. PostgREST over plain HTTPS (no SDK).** Every table is a REST resource at
`https://<ref>.supabase.co/rest/v1/<table>`. Send the anon key as both `apikey` and
`Authorization: Bearer <user-jwt>` (the user's session token from Supabase Auth — the anon key alone reads
only what RLS allows for an anonymous role). Example: `GET /rest/v1/items?select=*&order=created_at.desc`.
This maps cleanly onto an `api` library item if the designer authored one
(`baseUrl=https://<ref>.supabase.co/rest/v1`, `path=/items`, `method=GET`, an `apikey` header).

### Auth
Supabase Auth handles signup/login. Wire your login/signup screen's submit button in `onScreenReady`
(read `controls.email_address.text` / `controls.user_password.text`), call
`supabase.auth.signInWithPassword(...)` / `signUp(...)`, store the returned session in the platform secure
store (Android EncryptedSharedPreferences / Keychain on iOS — see backend-contract.md → Secrets), and
include that user JWT on subsequent calls so RLS resolves `auth.uid()`.

## 6. Do both platforms
Implement the same connector logic in **Android and iOS connector files** for the same `target`s, in each
language's idioms. Keep `NuiBackend.kt` and `NuiBackend.swift` as thin delegators. Behavior only —
anything visual stays in the HTML/CSS design and is re-imported.
