---
name: nativeui-backend
description: >-
  Stand up AND deploy the backend SERVER an exported NativeUI app talks to — the half nativeui-connect stops
  short of (it only wires the on-device NuiBackend contract). Use when the user asks to scaffold / stand up /
  spin up / create a backend or server, asks "what backend should I use", asks where / how to deploy the
  server, or needs the API/database the app's CALL_API / CALL_DATABASE / SUBMIT_FORM interactions point at.
  Reads project.json to DERIVE the endpoints/DB/auth the app needs, recommends a stack from the installed
  toolchain (Node/Python/BaaS/Mock), scaffolds a minimal-but-runnable server with one route per derived
  endpoint, points the app connector/base-url code at the new base URL (dev localhost/10.0.2.2 + ATS/cleartext,
  prod HTTPS), and deploys (Cloud Run / Fly.io / Railway / Render / Vercel / Netlify / Docker-on-VPS).
metadata:
  argument_hint: "[project.json]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Read Write Edit Grep Glob Bash(npm*) Bash(node*) Bash(npx*) Bash(python3*) Bash(pip*) Bash(poetry*) Bash(uvicorn*) Bash(uv*) Bash(docker*) Bash(supabase*) Bash(firebase*) Bash(gcloud*) Bash(flyctl*) Bash(fly*) Bash(railway*) Bash(render*) Bash(vercel*) Bash(netlify*) Bash(curl*)"
---

# Stand up + deploy the backend server (the other half of "connect")

`nativeui-connect` wires the **on-device** contract: it keeps `NuiBackend.{kt,swift}` as thin delegation and
puts durable behavior in `*BackendConnector.*` classes so a tapped button or authored `CALL_API` runs your
code. But that code has to call **a real server** — and that server is the user's own, not something NativeUI
hosts. **This skill builds and deploys that server**, then points the connector/base-url code at it. It NEVER
touches generated UI (full rule set:
`${CLAUDE_SKILL_DIR}/../nativeui/references/backend-contract.md`).

`<bin>` = `${CLAUDE_SKILL_DIR}/../../bin`. `<tpl>` = `${CLAUDE_SKILL_DIR}/templates`. The plan tool
(`<bin>/nui-backend-plan.mjs`) derives the endpoints; the templates are the runnable scaffolds; the deploy
playbook is `${CLAUDE_SKILL_DIR}/references/backend-deployment.md`. This file is the glue — it references
those rather than restating them.

## 1. Preflight
```bash
node <bin>/preflight.mjs
```
Keep the account gate consistent with every other NativeUI action. Stop on non-zero exit and relay the exact
remedy. (You operate on an existing `project.json` / exported app; if a re-export is needed at the end, it is
required.) If there is no `project.json` yet, author + import one first (skill: **nativeui**) — you cannot
derive endpoints without it.

## 2. Derive the backend the app needs + detect the toolchain
If no approved `nativeui-architecture.md` exists, invoke `nativeui-architect` before scaffolding. That agent
audits any existing backend/repo, asks how the server should run locally, asks about eventual deployment and
repository shape, records the decision, and gets user approval. Continue here only after that architecture is
approved or the user explicitly asks to skip the architecture gate.

```bash
node <bin>/nui-backend-plan.mjs <project.json> --human
```
The plan tool walks the project's interactions (stage-level `stages[].interactions[]` and node-level
`...interactions[]`) and `libraryItems[]`, and prints, for the user to confirm:
- **Endpoints** — one per distinct backend-routed action, with the method/path it derives and where it came
  from. `CALL_API` (→ `onCallApi(target, params)`) and `SUBMIT_FORM` (a `<form>`, carrying
  `params.action`/`params.method`) become **HTTP routes**; `CALL_DATABASE` (→ `onCallDatabase`) becomes a
  **data route backed by a table/collection**. Each `target` resolves against a `libraryItems[]` `api`/
  `database` entry (config in its `configJson`) or the authored name.
- **Database needs** — the tables/collections implied by the `CALL_DATABASE` targets.
- **Repeater data sources** — any `repeater.adapterId` should resolve to a `dataAdapters[]` entry whose
  `sourceLibraryItemId` points at an `api`/`database` `libraryItems[]` entry; legacy `repeater.dataSource` may
  also imply a read route even if there is no explicit tap interaction.
- **Auth needs** — whether any flow implies a login / token (e.g. a login form, an authed endpoint).
- **Detected toolchain** — which of Node, Python (pip/poetry/uv), Docker, the Supabase/Firebase CLIs, and the
  deploy CLIs (gcloud / flyctl / railway / vercel / netlify) are actually installed on this machine.
- **A recommendation** — the lowest-friction viable stack + deploy target for the derived shape.

**Show the user this plan verbatim.** It is the contract for everything below: the route list becomes the
server's routes, and the same list is what connector classes will call. (Note the contract honestly:
`OPEN_URL` / `RUN_SCRIPT` / `SET_STATE` have **no** backend route and `NAVIGATE_TO_STAGE` /
`TOGGLE_VISIBILITY` / `ANIMATE_PANEL` run on-device with zero server code — the plan excludes them. If the app
has **no** backend-routed actions, say so: it needs no server, and you stop here unless the user wants one
anyway for future use.)

## 3. ASK the stack (offer only installed-viable options)
Present the stacks the detected toolchain can actually run, with the tradeoff in one line each, and let the
user pick. Do not offer one whose toolchain is missing (say what to install if they want it):
- **Node (Hono)** — `<tpl>/node-hono`. Smallest JS server; great if the app team already lives in JS. Hono is
  lean + edge-deployable; runs as plain ESM (`src/app.js` exports the app, `src/index.js` serves it) with a
  one-line swap to Express noted in `src/app.js`.
- **Python (FastAPI)** — `<tpl>/python-fastapi`. Typed, auto-docs, strong for data/ML-adjacent backends.
- **BaaS (Supabase or Firebase)** — `<tpl>/baas/supabase` / `<tpl>/baas/firebase`. **Least code** — managed
  Postgres+Auth (Supabase) or Firestore+Auth (Firebase); you write almost no server, just config + a couple of
  edge/cloud functions for `CALL_API`. Best when the needs are mostly CRUD + auth.
- **Mock / local-first** — `<tpl>/mock-local`. A zero-dependency Node server that returns canned JSON for every
  derived route. **Best for prototyping**: lets the app run end-to-end on device TODAY, no cloud, no database;
  swap in a real stack later without changing connector call sites (same routes).

State the **recommendation from step 2** and why, but the user decides. Confirm the choice before writing.

## 4. Scaffold the chosen server + fill the endpoint region
Copy the chosen template into the user's workspace (default `./backend`, ask if they want elsewhere), then
**fill the endpoint region** — the template ships a clearly marked endpoint block (Node/Python:
`// === app endpoints (fill from nui-backend-plan) ===` … `// === end app endpoints ===` /
`# === app endpoints (fill from nui-backend-plan) ===`). Replace it with **one route per derived endpoint from
step 2**, idiomatic to the stack (a Hono handler, a FastAPI path operation, a Supabase edge function / Firebase
callable, or a Mock canned response). Keep every other part of the template intact — it already provides what a
server MUST have to actually run:
- a **health route** (`GET /health` → `{ ok: true }` / `{ status: "ok" }`) so deploy targets' health checks
  pass and you can smoke it;
- **CORS** open to the app's origins (native apps send no Origin, but a web preview/companion does — leave it
  permissive in dev, tighten for prod per the template comment);
- **env-driven config** (`PORT`, and any secret as an env var — NEVER hardcode keys; the contract reference's
  "Secrets" section is the law here);
- an **example of the derived endpoint shape** so the pattern is obvious for routes you add later.

Then prove it runs locally with the template's documented command (e.g. `npm install && npm run dev`,
`pip install -r requirements.txt && uvicorn main:app --reload`, `node mock-server.mjs` for Mock) and `curl` the
health route + one derived route. Don't move on until it serves.

## 5. Point connector code at the new base URL — EXTEND, never overwrite
The server now has a base URL (dev: `http://localhost:<PORT>`; prod: your deployed HTTPS origin). Wire the
app's connector classes to call it, adding thin delegation in `NuiBackend.*` only if needed — **extend in
place, preserving existing user code**; never regenerate or overwrite them, and never touch any generated file.
The exact platform mechanics (where the
const goes, the emulator/simulator host difference, and the iOS ATS / Android cleartext config a dev HTTP URL
requires) are in **`${CLAUDE_SKILL_DIR}/references/backend-deployment.md` → "Wiring the app to your backend"**.
The load-bearing facts that section covers (verified against the exporters):
- **iOS simulator** reaches a server on the host Mac at **`http://localhost:<PORT>`**; **Android emulator**
  reaches the host at **`http://10.0.2.2:<PORT>`** (NOT `localhost`, which is the emulator itself). Use a
  per-platform dev base URL.
- A plain-**HTTP** dev URL is blocked by default on both platforms — the clean export ships **no** ATS
  exception (iOS `Info.plist`) and **no** cleartext permission (Android manifest). For local dev you must add
  an `NSAppTransportSecurity` localhost exception to `Info.plist`, and `android:usesCleartextTraffic="true"`
  (or a `network_security_config` limited to `10.0.2.2`) + the `INTERNET` permission to the manifest. The
  reference gives the exact snippets. **Production uses HTTPS** → drop the exceptions and flip the base URL to
  the deployed origin.
- Keep the base URL a single `const`/build-config value used by connector classes so the dev→prod switch is one
  line on each platform, and **do both platforms** for the same design.

## 6. ASK the deploy target, fill it in, and write BACKEND.md
Ask which target the user wants (offer only those whose CLI is installed, with the one-line tradeoff — full
matrix in `references/backend-deployment.md`):
- **Cloud Run** (`<tpl>/deploy/cloud-run`) — container, scales to zero, `gcloud`; the NativeUI house default.
- **Fly.io / Railway / Render** (`<tpl>/deploy/fly-railway-render`) — git-push / CLI PaaS, minimal config,
  good free-ish tiers.
- **Vercel / Netlify** (`<tpl>/deploy/vercel-netlify`) — best for the Node/Hono + serverless-function shape and
  BaaS edge functions; not for a long-lived Python process.
- **Docker-on-VPS** (`<tpl>/deploy/docker-vps`) — the `Dockerfile` + compose for any box you control.
- **BaaS / Mock skip this step** — a BaaS is hosted by the provider (deploy nothing, or a thin proxy via
  `deploy/cloud-run`); the Mock server is local-only.

Copy the chosen deploy template, **fill in app name / region / and the secret NAMES** (values via the target's
secret store, never committed), and walk the user through the one deploy command. Confirm with `curl <prod>/health`.

Then **write `BACKEND.md` in the user's project** capturing, crisply:
1. the **chosen stack** + why; 2. the **endpoint list** (method, path, which interaction target it serves);
3. **how to run locally** (the command + the dev base URL per platform); 4. **how to deploy** (the command +
the prod origin); 5. the **base-URL switch** (the one line in connector/base-url config to flip dev↔prod, plus the
ATS/cleartext note). Keep it a reference card, not a tutorial — point at the templates + `backend-deployment.md`.

## 7. Re-export if a design change was required
If wiring forced an id rename or any design change, re-author + re-import the affected screen (skill:
**nativeui-update**) and re-export both platforms — `NuiBackend.*`, connector classes, and base-URL wiring survive
regeneration:
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```

## Hard rules
1. **The server is the USER's.** NativeUI hosts nothing for the app; you scaffold + deploy to the user's own
   account. Default to `dev.nativeui.com` conventions only for the plugin's own auth/config, never the app's
   backend host.
2. **Edit only app-owned backend files**: connector classes for calls/base URL and thin `NuiBackend.*`
   delegation if needed. If you reach for `MainActivity`, any `Generated*`, `NuiScreenControls`, or
   `NuiScreenDelegate`, stop. **Both platforms, mirrored.**
3. **Never hardcode secrets** anywhere in the app or the server source — env vars / the platform secret store
   only (backend-contract.md → Secrets). The exported app is decompilable; prefer the backend-proxy pattern.
4. **The route list is the single source of truth** — the server's routes and connector calls are the
   SAME list the plan derived. If they drift, re-run the plan.

## References (load as needed)
- `${CLAUDE_SKILL_DIR}/references/backend-deployment.md` — base-URL wiring (ATS/cleartext, localhost vs
  10.0.2.2), the deploy-target matrix, and per-target deploy steps.
- `${CLAUDE_SKILL_DIR}/templates/` — the runnable server scaffolds (one per stack) + `deploy/` targets.
- `${CLAUDE_SKILL_DIR}/../nativeui/references/backend-contract.md` — the on-device contract + the trigger/
  action vocabulary the plan derives from, and the Secrets rules.
- `${CLAUDE_SKILL_DIR}/../nativeui-connect/SKILL.md` — wiring the on-device side once the server exists.
