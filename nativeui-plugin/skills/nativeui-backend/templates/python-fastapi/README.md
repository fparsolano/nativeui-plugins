# NativeUI backend — Python / FastAPI

The server your exported NativeUI app talks to. The app's `NuiBackend.{kt,swift}`
makes HTTP calls to this server (one per authored `CALL_API` / `CALL_DATABASE` /
`SUBMIT_FORM` interaction); this server answers them. The on-device half is
`NuiBackend.*` (see the `nativeui-connect` skill); this is the **other** half —
your own server, on your own host.

## Run (local dev)

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt                     # or: poetry install  (uses pyproject.toml)
cp .env.example .env                                 # then edit .env
uvicorn main:app --reload                            # http://127.0.0.1:8000
```

- Health check: <http://127.0.0.1:8000/health> → `{"status":"ok"}`
- Interactive docs (auto-generated): <http://127.0.0.1:8000/docs>

`--reload` watches files and restarts — dev only. For production the deploy plan
runs `uvicorn main:app --host 0.0.0.0 --port $PORT` (no reload).

## How endpoints get filled

The `# === app endpoints (fill from nui-backend-plan) ===` region in `main.py`
is where your project's routes go — **one per authored interaction** in your
`project.json`. The backend plan derives each route's path / method / body from
the interaction's `action` and target:

| Authored action (on a node) | Device call (`NuiBackend`) | Suggested route |
|---|---|---|
| `CALL_API`, target `login` | `onCallApi("login", params)` | `POST /api/login` |
| `CALL_DATABASE`, target `trips` | `onCallDatabase("trips", params)` | `GET /db/trips` |
| `SUBMIT_FORM` (a `<form action=…>`) | you POST it from `onScreenReady` | `POST {form action}` |

The worked example in `main.py` is the `CALL_API` target `login`: a `POST
/api/login` with a Pydantic `LoginRequest`/`LoginResponse`. Copy that shape per
endpoint, swapping the model fields and the body for your real logic (DB lookup,
auth, etc.). `params` arrives on the device as a flat string map — model the
JSON body you expect and let FastAPI validate it (a malformed body returns 422).

`GET /health` and CORS are already wired; leave them.

## Pointing the app at this server

The exported app needs a base URL. The exporters do **not** bake one in — you set
it in `NuiBackend.{kt,swift}` (or build config) and add the per-platform network
permissions, because both default to HTTPS-only:

- **iOS** — calling plain `http://` (e.g. `http://localhost:8000` in the
  simulator) requires an **App Transport Security** exception in `Info.plist`
  (`NSAppTransportSecurity` → `NSAllowsLocalNetworking`, or a per-domain
  exception). A real `https://` host needs none. *(The generated `Info.plist`
  ships no ATS exception by default.)*
- **Android** — the generated `AndroidManifest.xml` declares **no** `INTERNET`
  permission and **no** cleartext flag. Add `<uses-permission
  android:name="android.permission.INTERNET"/>`, and for plain `http://`
  (e.g. `10.0.2.2:8000`, the emulator's host alias) add
  `android:usesCleartextTraffic="true"` or a `network-security-config`. HTTPS
  needs only the `INTERNET` permission.

Keep secrets (third-party API keys) on **this** server, not in the app — the app
ships to devices and is decompilable. The app calls your endpoint; your endpoint
holds the key (`NUI_API_KEY` in `.env` locally, a real secret on your host).

## Deploy

Containerize and run `uvicorn main:app --host 0.0.0.0 --port $PORT`. The backend
plan emits the target-specific config (Cloud Run / Fly.io / Railway / Render /
Docker-on-VPS), wiring `$PORT` and your env vars as that platform's secrets.
