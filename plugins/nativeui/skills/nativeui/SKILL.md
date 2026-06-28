---
name: nativeui
description: >-
  Author native iOS + Android apps with NativeUI. Use when the user asks to build/make/design/prototype
  a mobile app, screen, or UI with NativeUI — including responsive layouts, animations, navigation,
  forms, charts — or to connect/wire a NativeUI app to a backend (APIs, database, events). Handles messy
  inputs such as PDFs, screenshots/images, Figma, source code, and HTML/CSS. The workflow: intake inputs,
  write plain HTML/CSS, audit responsiveness, import it to a NativeUI project, export native iOS + Android
  screens, and wire backend through thin NuiBackend delegation plus durable connector classes.
metadata:
  argument_hint: "[app idea or screen description]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui` inside the installed plugin source before running commands.



# NativeUI app authoring

You design apps by writing **plain HTML/CSS**, importing it into a NativeUI **project** (`project.json`),
and exporting **native iOS + Android** screens. You never write SwiftUI/UIKit/Compose/XML by hand — NativeUI
generates the native UI. Backend logic is added through a generated **interface contract**, never by editing
generated UI code.

Leverage NativeUI for **everything visual and structural** — responsiveness, animations, navigation, forms,
charts, gradients, shadows. Only drop to platform code for backend behavior (APIs, database, app logic), and
only through the `NuiBackend` surface (see `references/backend-contract.md`).

## Golden rules (read `references/authoring-rules.md` for the full spec)

1. **Plain HTML/CSS only.** Embedded `<style>` + inline `style`. NO `<script>`, NO external/CDN stylesheets,
   NO `data-*` attributes (stripped on import) — those abort or get ignored. Structure = semantic HTML; layout
   + appearance = CSS, exactly as a browser renders it.
2. **Mobile-first, `412 × 915` default stage.** Author for 412px width first.
3. **Responsiveness = CSS `@media` width breakpoints** → become NativeUI smart divisions that re-resolve per
   device width (on device too).
4. **Animations = `@keyframes` + `animation`** → become the NativeUI timeline (runs on device).
5. **Stable, letter-first ids** (`id="login_button"`, never starting with a digit) so the backend gets a
   typed control accessor on both platforms.
6. **Multi-page** apps = one HTML document per screen; link screens with `<a href="#...">` — the target
   resolves by the destination screen's **title/name slug** (`<title>Trip Detail</title>` → `href="#trip-detail"`)
   or a **1-based page index** (`#page2` / `#2`), **NOT an element id**. `http/https/mailto/tel` hrefs become
   OPEN_URL. Nav resolves only in a ≥2-screen import and swaps screens on device with zero backend code.
7. **Messy inputs go through intake; generated screens go through responsive audit.** If the user gives PDF,
   screenshot/image, Figma, source code, existing HTML/CSS, or URLs, run `nui-intake.mjs` first. Before import
   or export, run `nui-responsive-audit.mjs` on authored HTML/CSS or `project.json`; fix failures unless the
   user explicitly asked for a fixed non-responsive design.
8. **Loose/static design input goes through `nativeui-design`.** If the user is not starting from production
   HTML, or the HTML is plain/static/non-responsive, invoke `nativeui-design` to create a styling guide and
   responsive UX direction before authoring or re-authoring HTML/CSS.

## Workflow

### 0. Auth preflight (ALWAYS FIRST — the moment this skill is invoked)
**Before planning, authoring, or anything else, the FIRST thing you do is check auth.** Run the preflight gate.
**If it reports not-logged-in, immediately start the SSO sign-in yourself — run `login.mjs` (see "Signing in"
below) WITHOUT asking permission first** and paste the user the link + code. Signing in is the only setup the
user needs (no configuration). Do not author, import, or export until preflight passes:
```bash
node <bin>/preflight.mjs
```
On success it prints `ok: <email>, subscription active`. On failure it prints the exact remedy and exits
non-zero. **No configuration is needed** — the dev backend hosts are pre-baked in `config.mjs`, and
identity-provider keys stay server-side in profile-api; the only auth step is SSO sign-in plus an active
subscription:
- **not logged in / session expired → DON'T stop and ask — immediately run `login.mjs` to start SSO (see
  "Signing in" below), paste the link + 8-char code to the user, wait for them to approve, then re-run
  preflight. Repeat until it passes.** This is the one and only step a new user needs.
- no active subscription → activate one on the account billing page, then re-run preflight;
- config error (rare — only if a custom `~/.nativeui/config.json` / `NATIVEUI_*` override blanked a field) →
  remove that override to use the baked default, or give it a real value. (Overrides are only for targeting a
  non-default environment, e.g. self-host / prod.)

#### Signing in
Sign-in is **browser SSO only** — there is no password method to offer the user. When the user needs to
sign in, run it (no flag needed; SSO is the default):
```bash
node <bin>/login.mjs
```
It requests a device code and **auto-opens the user's browser** to the verification page with the code
**pre-filled** (`https://dev.nativeui.com/device?userCode=…`), then polls until they approve. Critically:
**ALWAYS paste the printed verification URL + the 8-char code to the user verbatim** — if the browser didn't
auto-open (no default browser / headless), they click that link and the code is already filled in, then press
**Authorize**. They must approve in the browser where they're already signed in to `dev.nativeui.com`. Let the
command finish on its own; on success it prints `Logged in as <email>` — then re-run `preflight.mjs`.

#### Tenant policy / external disclosure denial
If Codex, an approval reviewer, or tenant policy says uploading generated screens/project JSON to
`dev.nativeui.com` is denied as external disclosure, **STOP**. Do not retry the same upload, ask for another
one-off approval, or route around the denial. Present the two approved paths:
- Workspace admin allowlist: use `admin/codex-requirements.nativeui.example.toml` from the Codex plugin package
  (or `nativeui-plugin/admin/` in the source checkout) to approve `dev.nativeui.com` / `webapp.dev.nativeui.com`
  for generated NativeUI HTML/project JSON only.
- Internal export fallback: point `~/.nativeui/config.json` at an approved internal/self-host export service and
  set `"exportAuthMode": "none"`. This enables import/export/validation only; cloud save, preview, project sync,
  library secrets, and parity reports still require hosted NativeUI auth.

#### Save to the cloud (optional, ask after auth)
Once authed and a `project.json` exists, **ASK** whether to save it to the user's NativeUI cloud account
(it then opens in the desktop + web editors). If yes, get a **name** (required) and an optional location/folder:
```bash
node <bin>/nui-save.mjs project.json --name "My App" [--location "Folder"]
```
Create-or-update by name: re-saving the same name updates the existing cloud project.

### 1. Intake source material when present
If the user supplies PDFs, screenshots/images, Figma links or JSON, existing HTML/CSS, source files/folders, or
URLs, normalize them before planning:
```bash
node <bin>/nui-intake.mjs <input...> -o nativeui-intake.json
```
For a prompt-only run with concrete product requirements:
```bash
node <bin>/nui-intake.mjs --prompt "<user request>" -o nativeui-intake.json
```
Read the bundle. Use its provenance, breakpoints, assets, source summaries, and `gaps[]`. Do not claim fidelity
for unresolved gaps; inspect the source or ask for the missing asset/export only when the gap blocks correctness.

### 1b. Design direction for non-HTML or static inputs
Invoke `nativeui-design` before screen planning/authoring when the source is a prompt, PDF, screenshot/image,
Figma, source code, URL, or HTML that looks plain/static/non-responsive. The design agent asks the short
responsiveness/portrait/landscape/UX brief when needed, creates `nativeui-design-guide.md`, and upgrades the
layout, animation, styling guide, and responsive direction while staying inside NativeUI's supported HTML/CSS
surface. Skip only when the user explicitly wants to import already-responsive HTML exactly as-is.

### 2. Plan the screens
From the user's idea, list the screens and the key components per screen. Confirm the platform target
(both iOS + Android by default) and any responsive/animation/backend requirements. If `nativeui-design-guide.md`
exists, use it as the visual source of truth for tokens, responsive breakpoints, motion, and UX states.

If the user asks for functionality (API calls, database reads/writes, auth/login, form submission, taps that
change app state, or other native behavior), use the `nativeui-developer` skill as the source-of-truth workflow:
sync-check `project.json`, register API/database library items, store secrets only in the user's account, and
wire matching Android + iOS connector implementations.

For data-backed lists, use repeaters plus data adapters deliberately: plain HTML imports concrete rows, then the
project/editor can mark a container's children as a repeater template. Add a `dataAdapters[]` entry that points
at the registered `api`/`database` library item, maps source fields into `{{item.*}}`, and carries non-secret
sample rows for native/web preview; set `repeater.adapterId`. Still wire live runtime data in both Android + iOS
connectors.

### 3. Author HTML/CSS (one document per screen)
Write each screen as a complete standalone HTML document per `references/authoring-rules.md`. Use the
`examples/` as templates. Keep it mobile-first; add `@media` for responsiveness and `@keyframes` for
animation. Give every interactive/named element a stable letter-first `id`.

### 4. Audit responsiveness before import
Generated app flows must have a responsive path:
```bash
node <bin>/nui-responsive-audit.mjs home.html settings.html
```
Fix failures by adding real responsive structure: `@media` width breakpoints, `%`, `fr`, `flex-grow`, viewport
units, `calc()`/`clamp()`, or better flex/grid structure. Use `--allow-static` only when the user explicitly
wants a fixed non-responsive design.

### 5. Import → `project.json`
Turn the HTML/CSS into a NativeUI project with `nui-import.mjs` (one file argument per screen, in screen order):
```bash
node <bin>/nui-import.mjs home.html settings.html -o project.json
```
Each page name comes from the HTML file's basename. The script POSTs to `/export/import/html` with a fresh
token and writes the returned project to `-o` (default `./project.json`). If the service returns `errors[]`,
it prints them and **writes nothing** — FIX the HTML/CSS and re-import; never hand-edit around an import error.

After import, audit the project too when you are inside an iteration/debugging flow:
```bash
node <bin>/nui-responsive-audit.mjs project.json
```

### 5b. Preview the project (optional, OFFER it before exporting)
Once a `project.json` exists, **OFFER to preview it** in the web companion editor before exporting/building —
the user can see + tweak the design first. It cloud-SAVES the project (create-or-update by name) and points
them at the web editor, where it opens from "Open from cloud" (and also opens in the desktop editor — it's
the shared cloud document):
```bash
node <bin>/nui-preview.mjs project.json --name "My App" [--location "Folder"] [--open]
```
Requires being logged in (the save path). It prints the editor URL + the exact name to pick; pass `--open` to
best-effort open the browser. (`--no-save` is a local-only check that prints the URL but uploads nothing — there
is no live preview without a save.) For a pure structural/model check without a save, use `nui-validate.mjs`.

### 6. Export native iOS + Android
From the `project.json`, produce both native projects with `nui-export.mjs` (run it once per platform):
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```
Each writes `<outdir>/<platform>-export.zip` and unzips it in place when `unzip` is available. Add `--manifest`
to fetch only the file list (no full ZIP). Hand off where the projects are + how to open/run them (Android
Studio / Xcode). **Offer to run it locally**: `node <bin>/nui-run.mjs project.json --platform both` builds +
launches the real PROD app (clean export: anim/responsive/effects/events all work) on the local emulator +
simulator — see the **nativeui-run** skill.

### 7. Wire backend (only if asked) — both platforms, connector classes by default
For functionality work, follow `nativeui-developer` first. This section is the connector implementation layer
after project sync, API/database library registration, and secret handling are settled.

When the user asks to connect the app (login, fetch data, save to a database, respond to a tap), first plan the
durable connector classes:
```bash
node <bin>/nui-connectors-plan.mjs project.json --human
```
Keep **`NuiBackend.kt` (Android) and `NuiBackend.swift` (iOS)** as thin write-once delegators: instantiate or
register the planned connector classes and forward `onScreenReady`/delegate hooks. Put durable app/backend
logic in matching `*BackendConnector.kt` and `*BackendConnector.swift` classes. Make the change on **both**
codebases for the same design. NEVER edit any generated file (MainActivity, the
`Generated*`/`NuiScreenControls`/`NuiScreenDelegate`). Full rules + examples: `references/backend-contract.md`.
The backend code only *calls* a server — to scaffold AND deploy that server (derive the endpoints from
`project.json`, pick a Node/Python/BaaS/Mock stack from your toolchain, point the base URL at it, and deploy to
Cloud Run / Fly / Vercel / a VPS), invoke **nativeui-architect** first when no approved
`nativeui-architecture.md` exists, then use the **nativeui-backend** skill after the user approves the local
run/deployment/repository plan.

**Pin the contract with tests (offer after wiring).** Generate iOS XCTest + Android JUnit/Robolectric tests that
assert the NuiBackend contract (the typed accessors compile/resolve, `onScreenReady` is invoked, the delegate
hooks exist, a smoke) so a future re-export or a designer rename that breaks the surface fails loudly:
```bash
node <bin>/nui-test-gen.mjs project.json --platform both --out ./android-out --ios-out ./ios-out
```
These target the GENERATED contract surface only — never generated UI. Full templates + how to wire them into
Gradle/Xcode: the **nativeui-test** skill.

### 8. Final design review before handoff
Before saying the design/app is done, run the final reviewer:
```bash
node <bin>/nui-final-review.mjs \
	  --project project.json \
	  --html home.html settings.html \
	  --intake nativeui-intake.json \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --android-dir ./android-out \
  --ios-dir ./ios-out \
  --human
```
Omit inputs that do not exist yet, but always include `--project` once imported. If the app has backend-required
functionality, include the approved `--architecture nativeui-architecture.md`. Fix non-zero errors before
handoff. The reviewer checks NativeUI import validity, responsiveness, stable ids, event/runtime mistakes,
unresolved intake gaps, architecture approval, and whether backend logic leaked into `NuiBackend.*` instead of
connector classes.
Pass the latest user requirements as inline text or a path/`@path` file so explicit constraints like
"no backend/API/events" are checked against the generated project.

### 9. Iterate
Three ways, smallest blast radius first (see `references/project-model.md` for the full schema + safe-edit rules):

**a) Direct `project.json` edit (fastest — a color/text/position/value, add/remove/reorder a node, or add
repeater metadata/sample rows to an existing list container).**
The model round-trips as a strict fixpoint, so a *valid* hand-edit is safe. Find the node by `id`, change the
documented field (keep color format `#rrggbb@alpha`, ids letter-first + unique, valid `kind`), and — **always**
— validate before export:
```bash
node <bin>/nui-validate.mjs project.json
```
It runs an authoritative model round-trip (when logged in) plus a structural check, and **fails closed** with
a clear message. Pass `--structural` for the structural-only check. Use this whenever you touch `project.json`
by hand. **What's safe to direct-edit vs what needs a re-import is in `project-model.md` §9** — structural
redesign, flex/grid/responsive/animation, and `nui.*` layout props should be re-authored, not forged.

**b) Granular fragment round-trip (regenerate ONE component/section from HTML).** Extract a part to HTML, edit
it, re-import it to a node subtree, and splice it back — without re-authoring the whole screen:
```bash
node <bin>/nui-fragment-extract.mjs project.json --id trip_card -o card.html
# edit card.html ...
node <bin>/nui-fragment-import.mjs  card.html -o card-subtree.json
```
`card-subtree.json` has `{ rootNodes, libraryItems }`. Replace the matching node in a stage's `rootNodes` (or a
node's `children`) with the new `rootNodes`, merge any `libraryItems` into the project's `libraryItems`, then
run `nui-validate` before export.

**c) Full re-author + re-import (structural change to a whole screen).** Re-author its HTML/CSS and **re-import**
with `nui-import.mjs` (round-trip-safe). Re-export regenerates the UI around the untouched `NuiBackend.*`, so
backend code survives.

To see a change running, build + launch the clean PROD app on the local emulator / simulator with
`node <bin>/nui-run.mjs project.json --platform both` (skill: **nativeui-run**).

## Verifying your output

### The prod-quality guarantee (why a clean export is correct)
NativeUI's production quality comes from the **validated exporter**, not from anything Claude does per design.
The parity corpus + the Flow-D loop hold the pipeline at **zero per-node deltas across editor == web == iOS ==
Android** for every covered case, so the iOS/Android exporters are correct **by construction**: a clean
(`--prod`) export of an imported design renders the design faithfully on both platforms. You do **not** verify
this per app — you trust the validated exporter, and you keep the design inside the supported surface (below).

**Prod vs beta, honestly:**
- **clean/prod** = the default, idiomatic, runnable native project (no parity instrumentation). This is what you ship.
- **`--beta`** additionally ships the parity **instrumentation** that lets a render delta be
  *measured* on a real design. When a beta render diverges from the editor, that is a **new exporter gap** —
  surface it with `node <bin>/nui-report-parity.mjs` (the telemetry loop that files the
  delta to the bugs API). That's how new gaps on real designs get found and fixed at the exporter; it is not
  something you patch in the app.

### Unsupported-feature detection (degrades silently — guard against it)
An unsupported CSS feature does **not** error on import — it is **silently dropped**, so a browser mockup can look
right while the imported app differs. Two defenses, both required:
1. **Author within the supported surface.** Follow `references/authoring-rules.md` and heed its
   **"Not supported / degrades"** list (e.g. `conic-gradient`, non-`uppercase` `text-transform`,
   `text-align:justify`, RTL, `em` sizing, per-corner `border-radius` longhands, remote `<img>`,
   non-blur `filter`/`backdrop-filter`, `stroke-dashoffset`). If a mockup uses one, rewrite it the supported way
   **before** importing — don't ship a design that relies on a dropped feature.
2. **Treat import `errors[]` as hard failures.** When the importer returns `errors[]` (a `<script>`, an external
   stylesheet, malformed input), `nui-import.mjs` prints them and **writes nothing** (exits non-zero). Never work
   around an import error by hand-editing `project.json` — fix the HTML/CSS and re-import.

### In-repo parity verification
If working **inside the NativeUI repo**, validate end-to-end with the parity harness (`scripts/flow-a-parity.sh`
for editor==webapp; `parity/scripts/verify-{ios-,}case-end-to-end.sh` for native) — zero per-node deltas. (Outside
the repo you rely on the validated exporter + the beta→`nui-report-parity` loop above.)

## References (load as needed)
- `<this-skill>/references/authoring-rules.md` — the exact HTML/CSS surface + every NativeUI capability.
- `<this-skill>/references/backend-contract.md` — generated-vs-write-once + the NuiBackend API.
- `<this-skill>/references/project-model.md` — `project.json` schema, references, page updates, toolchain commands.
- `<this-skill>/examples/` — gold HTML/CSS screens to copy from.
