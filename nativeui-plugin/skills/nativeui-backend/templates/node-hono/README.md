# nui-backend — Node + Hono

The minimal server your exported NativeUI app talks to. The app's on-device `NuiBackend.{kt,swift}`
is the only place you wire network calls (see the `nativeui-connect` skill); this is the other half —
the server those calls hit. Tiny, runnable, idiomatic; bring your own DB/auth.

## Run locally

```bash
npm install
cp .env.example .env      # then edit .env
npm run dev               # node --watch — reloads on save, http://localhost:8787
```

```bash
curl http://localhost:8787/health
# {"ok":true,"service":"nui-backend","ts":...}

curl -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"secret"}'
# {"token":"...","email":"a@b.com"}
```

Plain ESM — no build step. `npm start` runs `node src/index.js` once (the exact command the Docker recipes
use as their `CMD`); `npm run dev` adds `--watch`. The app is split so it runs both standalone and serverless:
`src/app.js` defines + exports the Hono `app` (routes, no listen), `src/index.js` imports it and calls
`serve()`. The Vercel/Netlify adapters import that same `src/app.js`.

## How the skill fills this in

The `nativeui-backend` skill reads your `project.json`, finds every authored `CALL_API` interaction, and
injects one route per endpoint into the marked region of `src/app.js`:

```js
// === app endpoints (fill from nui-backend-plan) ===
//   ... routes generated here, one per CALL_API target ...
// === end app endpoints ===
```

The contract: an authored `CALL_API` becomes `onCallApi(target, params)` on device — `target` names the
endpoint (a `libraryItems[]` `api` item id, or the authored name), `params` is a **flat `string` map**.
So each target maps to one route here that reads that param map as a JSON body and returns JSON. The
worked `/api/login` example shows the shape; keep new routes to that pattern so the device and server stay
in lockstep. (`CALL_DATABASE` → `onCallDatabase` and `PLAY_TIMELINE` → `onPlayTimeline` follow the same
target/params shape if you route those to the server too.)

## Reaching this server from the app (device-side, in `NuiBackend.*`)

The exporter does **not** scaffold a base URL or networking — that's yours. Put the base URL in app config
(iOS `.xcconfig`/`Info.plist` build setting; Android `BuildConfig`/`local.properties`) and read it in
`NuiBackend.*`, then `fetch`/`URLSession`/`OkHttp` to the routes here. A few gotchas that block a working
call by default:

- **iOS ATS:** the generated `Info.plist` ships no `NSAppTransportSecurity` key, so iOS blocks plain
  `http://` (incl. `http://localhost`). For local dev add an ATS exception (e.g. `NSAllowsLocalNetworking`,
  or a per-domain exception) to `Info.plist`; in production use `https://` and you need nothing.
- **Android INTERNET + cleartext:** the generated `AndroidManifest.xml` declares **no** `INTERNET`
  permission and sets no `usesCleartextTraffic`. To call out, add
  `<uses-permission android:name="android.permission.INTERNET"/>`; to hit plain-`http` localhost in dev,
  also set `android:usesCleartextTraffic="true"` on `<application>` (or a `networkSecurityConfig`). HTTPS in
  prod needs neither cleartext flag.
- **localhost ≠ the device:** an emulator/simulator can't see your Mac's `localhost`. Android emulator uses
  `http://10.0.2.2:<port>`; iOS Simulator can use `http://localhost:<port>`; a real device needs your
  machine's LAN IP or a deployed URL.
- **CORS:** native HTTP from a device sends no `Origin`, so CORS here is for browser callers/tools only;
  set `ALLOWED_ORIGINS` to a real origin (not `*`) once a web caller is involved.

## Secrets

Third-party API keys go in `.env` (this server), never in the exported app — it's decompilable. The safest
pattern is exactly this: the device calls *your* endpoint, your endpoint holds the key and calls the third
party. The `API_KEY` env var in `src/app.js` is the placeholder for that.

## Deploy

See the deploy targets in the `nativeui-backend` skill (Cloud Run / Fly / Railway / Render / Docker-on-VPS).
All you need from this template: bind `process.env.PORT`, expose `/health`, and run `node src/index.js`
(i.e. `npm start`) as the container command.
