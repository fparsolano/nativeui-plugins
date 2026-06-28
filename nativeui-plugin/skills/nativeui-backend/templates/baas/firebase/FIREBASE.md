# Firebase backend for your NativeUI app

**Least-server-code path #2 — and the most synergistic** if you already use Firebase/GCP (the NativeUI
plugin itself authenticates against a Firebase project). Firebase gives you **Firestore** (a hosted
NoSQL DB with on-device SDKs + security rules), **Auth**, and **Cloud Functions** (for the bits that need
server code). Your exported app talks to it from app-owned `*BackendConnector.{kt,swift}` classes, with
`NuiBackend.{kt,swift}` kept as thin delegators. Two clear lanes:
- **Reads/writes of the user's own data** → call **Firestore directly** from the device (rules enforce ownership).
  No server code at all.
- **A real backend operation** (talk to a third-party API with a secret, run privileged logic) → a small
  **callable Cloud Function**, which a designer-authored `CALL_API` maps onto.

> Where this fits: NativeUI routes designer-authored events to delegate hooks (`onCallApi`,
> `onCallDatabase`, `onScreenReady`) whose default bodies are empty — you implement them in connector
> classes. Nothing here
> touches a generated file (see `../../../../nativeui/references/backend-contract.md`).

## 1. Create / pick a project
1. <https://console.firebase.google.com> → **Add project** (or reuse the one you already have).
2. **Build → Firestore Database → Create database** → start in **production mode** (locked; we ship rules below).
3. **Build → Authentication → Get started** → enable Email/Password (and any provider you want).
4. Install the CLI once: `npm i -g firebase-tools` then `firebase login` and `firebase init` (pick Firestore + Functions).

## 2. Firestore collections (match your app's needs)
Firestore is schemaless, but settle a shape. Owner-scoped, one subtree per user — matches the rules below:

```
users/{uid}                     ← one profile doc per signed-in user
  ├─ full_name : string
  ├─ email     : string
  ├─ bio       : string
  ├─ plan      : string   ("free" | "pro" | "team")
  └─ newsletter: bool

users/{uid}/items/{itemId}      ← the user's private list (rename to your domain: tasks/trips/orders…)
  ├─ ownerId      : string  (== uid; the rules require this)
  ├─ title        : string
  ├─ notes        : string
  ├─ status       : string
  ├─ amount_cents : number  (store money as integer cents)
  ├─ created_at   : timestamp
  └─ updated_at   : timestamp
```
Nesting items under `users/{uid}` makes the security rule a one-liner (own-path = own-data). A top-level
`items` collection with an `ownerId` field works too — adjust the rules to filter on `ownerId`.

## 3. Security rules
Use [`firestore.rules`](./firestore.rules) (owner-scoped, default-deny). Deploy:
```bash
firebase deploy --only firestore:rules
```
This is the load-bearing safety: the Firebase **client** config you ship (apiKey/appId/projectId) is
**publishable, not a secret** — it only identifies the project. Rules + Auth are what protect the data,
exactly like a web app. (The Admin SDK service-account key, by contrast, is a hard secret — server-only.)

## 4. Where the client config goes — connectors, never generated files
Download the app's Firebase config from **Project Settings → General → Your apps**:
- **Android** — the `google-services.json` placed in `app/` (the standard location); add the
  `com.google.gms.google-services` Gradle plugin + the Firebase BoM/SDK dependencies. Initialize and call
  Firebase from a `*BackendConnector.kt`.
- **iOS** — `GoogleService-Info.plist` added to the app target; add the Firebase SDK (SwiftPM). Call
  `FirebaseApp.configure()` early and use Firestore/Auth from a `*BackendConnector.swift`. The exported
  clean `Info.plist` is at `App/Info.plist`; `GoogleService-Info.plist` is a separate file you add.

> **Network access is NOT auto-configured by the exporter.** The generated `AndroidManifest.xml` has **no
> `INTERNET` permission** and the clean `Info.plist` has **no `NSAppTransportSecurity` block**. Firebase is
> HTTPS (iOS ATS is fine by default), but Android still needs, in the exported
> `app/src/main/AndroidManifest.xml`:
> ```xml
> <uses-permission android:name="android.permission.INTERNET" />
> ```

## 5. A callable Cloud Function for `CALL_API`
When a designer wires a button to **call API X** (`CALL_API`), the cleanest server target is a **callable**
function — it handles auth (the user's Firebase ID token is verified for you) and lets you keep third-party
secrets on the server, off the device.

```js
// functions/index.js  (Node, firebase-functions v2)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp();

// Designer action CALL_API target "create_item" maps here.
// `request.auth` is the verified caller; `request.data` carries your params.
exports.create_item = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const { title, notes } = request.data || {};
  if (!title) throw new HttpsError("invalid-argument", "title is required");

  const db = getFirestore();
  const ref = await db.collection("users").doc(uid).collection("items").add({
    ownerId: uid, title, notes: notes ?? "", status: "open",
    created_at: new Date(), updated_at: new Date(),
  });
  // ...or here: call a third-party API using a secret stored in the function's env.
  return { id: ref.id };
});
```
Deploy: `firebase deploy --only functions`.

## 6. How a designer-authored action maps to Firebase
On import, designer events become `interactions` with an `action` + `target`, optionally promoting a
`libraryItems[]` entry (`assetType: "api"` or `"database"`). At runtime the native routes them to a
delegate hook whose **default body is empty** — `NuiBackend` delegates to the connector that implements it:

| Designer action | Delegate hook you implement | Firebase target |
|---|---|---|
| `CALL_API` | `onCallApi(target, params)` | call a **callable Cloud Function** named `target` |
| `CALL_DATABASE` | `onCallDatabase(target, params)` | a **Firestore** read/write on the user's subtree |
| `SUBMIT_FORM` | *(no hook)* — wire the submit button in connector `onScreenReady` | read form controls, write to Firestore (or call a function) |

`target` is the interaction's target id (the `libraryItems[]` item id, or the authored name); `params` is
the authored `Map<String,String>`. `when`(Kotlin)/`switch`(Swift) on `target`, one branch per action.

> Note on the `database` library item: its `configJson` carries JDBC-style connectors
> (`postgresql, mysql, sqlite, …`) — there is **no "firestore" connector**. So treat a `database` item as
> *documentation of intent* (which collection/op the designer meant) and reach Firestore from the device
> via the Firebase SDK in the matching `onCallDatabase` branch.

### Sketches (both platforms — implement both)
```kotlin
// Android — AccountBackendConnector.kt
override fun onCallApi(target: String, params: Map<String, String>) {
    if (target == "create_item") {
        Firebase.functions.getHttpsCallable("create_item")
            .call(hashMapOf("title" to params["title"]))
            .addOnSuccessListener { /* update controls.* on main thread */ }
    }
}
override fun onCallDatabase(target: String, params: Map<String, String>) {
    val uid = Firebase.auth.currentUser?.uid ?: return
    if (target == "load_items") {
        Firebase.firestore.collection("users").document(uid).collection("items")
            .get().addOnSuccessListener { snap -> /* write rows into controls.* */ }
    }
}
```
```swift
// iOS — AccountBackendConnector.swift
func onCallApi(_ target: String, _ params: [String: String]) {
    guard target == "create_item" else { return }
    Functions.functions().httpsCallable("create_item")
        .call(["title": params["title"] ?? ""]) { _, _ in /* update controls.* */ }
}
func onCallDatabase(_ target: String, _ params: [String: String]) {
    guard target == "load_items", let uid = Auth.auth().currentUser?.uid else { return }
    Firestore.firestore().collection("users").document(uid).collection("items")
        .getDocuments { snap, _ in /* write rows into controls.* */ }
}
```

### Auth
Wire your login/signup screen's submit button in connector `onScreenReady` (read `controls.email_address.text` /
`controls.user_password.text`), call `Auth` signIn/createUser, and let the SDK keep the session. Subsequent
Firestore/callable calls are then authenticated automatically, so the rules resolve `request.auth.uid`.

## 7. Do both platforms
Implement the same connector logic in **Android and iOS connector files** for the same `target`s. Keep
`NuiBackend.kt` and `NuiBackend.swift` as thin delegators. Behavior only — anything visual stays in the
HTML/CSS design and is re-imported.
