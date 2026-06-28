# NativeUI — author native iOS + Android apps with Codex

You build apps with **NativeUI** by writing **plain HTML/CSS**, importing it into a NativeUI **project**
(`project.json`), and exporting **native iOS + Android** screens. You never write SwiftUI/UIKit/Compose/XML
by hand — NativeUI generates the native UI. Backend logic is added only through a generated **interface
contract** (`NuiBackend`), never by editing generated UI code.

Lean on NativeUI for **everything visual and structural** — responsive layouts, animations, navigation,
forms, charts, gradients, shadows, SVG. Drop to platform code only for backend behavior (APIs, database, app
logic), and only through the `NuiBackend` surface.

## How this is wired into Codex: the NativeUI SKILLS

This integration ships as a set of **Codex skills**, installed by `nativeui-codex/install.sh` into your Codex
skills directory (`~/.codex/skills` by default; `~/.agents/skills` also works). Codex owns the
developer-agent behavior contract; Claude Code mirrors it for distribution. The canonical developer-agent skill
lives at `nativeui-codex/canonical/nativeui-developer/SKILL.md`, and tests require the Claude mirror to match.
The installer installs every discovered NativeUI skill:

- **`nativeui`** — the primary playbook (golden rules + the full workflow + verification) with the reference
  docs (`authoring-rules`, `backend-contract`, `project-model`) and gold examples. Start here.
- **`nativeui-developer`** — the functionality orchestrator. Use for API/database/login/tap/form/state behavior,
  project sync, or native parity review. It enforces mobile = iOS + Android, web unsupported for v1, API/DB
  library registration, account-side secrets, guarded cloud saves, and mirrored connector implementations.
- **`nativeui-intake`** — normalize PDF/image/Figma/source/HTML inputs and run responsive audits before import.
- **`nativeui-design`** — design agent for prompt/non-HTML/plain-static HTML sources. It asks the
  responsiveness/portrait/landscape/UX brief, creates `nativeui-design-guide.md`, and turns references into a
  styling guide, animation system, and responsive direction before authoring.
- **`nativeui-architect`** — backend/deployment architecture gate. Use before backend scaffolding or major
  functionality work to audit existing repos, ask local run/deploy/repository choices, write
  `nativeui-architecture.md`, and wait for approval.
- **`nativeui-app`, `nativeui-import`, `nativeui-export`, `nativeui-run`, `nativeui-connect`, `nativeui-review`,
  `nativeui-backend`, `nativeui-test`, `nativeui-update`** — the driving/review skills the primary playbook
  points at ("see the nativeui-run skill", etc.) for a single step. All are installed so cross-references resolve.

Invoke them in Codex three ways:
- **Implicitly** — just describe the app you want; Codex loads the matching skill.
- `/skills` — pick `nativeui` (or a driving skill) from the list.
- `$nativeui [app idea]` — invoke by name.

> The `nativeui` skill's `SKILL.md` is the authoritative playbook (golden rules, the full workflow,
> verification). This file is the always-on orientation. The exact HTML/CSS surface, the backend contract, and
> the `project.json` schema live in the skill's **reference docs** (paths below) — read them before authoring or
> wiring. Do not invent NativeUI behavior; ground every claim in those docs or a tool's `--help`.

## The toolchain: `bin/*.mjs`

Every NativeUI capability is a small, agent-agnostic **Node script** (Node 18+, dependency-free). The install
copies them **once** to `<skills-dir>/nativeui/bin/` (the toolchain travels with the primary skill; every
skill's commands point at that one shared bin), and rewrites each skill's docs to call them by their **absolute
installed path**. They default to `https://dev.nativeui.com` and **fail closed** on auth (logged in **and** an
active subscription).

You run them as `node <skills-dir>/nativeui/bin/<script>.mjs …` — the exact command appears, fully resolved, in
every
step of the installed `SKILL.md` and `references/project-model.md`. Each script's header comment documents its
args/output; pass `-h` if unsure. The scripts:

`preflight` · `login` · `logout` · `token` · `nui-import` · `nui-validate` · `nui-export` · `nui-run` ·
`nui-save` · `nui-preview` · `nui-intake` · `nui-responsive-audit` · `nui-fragment-import` ·
`nui-fragment-extract` · `nui-project-sync` · `nui-library` · `nui-backend-plan` · `nui-connectors-plan` ·
`nui-design-guide` · `nui-architecture` · `nui-final-review` · `nui-test-gen` · `nui-report-parity`.

## Auth — zero-config, SSO-only sign-in

NativeUI import/export requires being **logged into dev with an active subscription**. **No configuration is
needed** — the `bin/` scripts ship baked-in NativeUI dev hosts, and identity-provider keys stay server-side in
profile-api, so a normal user configures nothing. The only auth step is the SSO sign-in:

1. **Sign-in is browser SSO ONLY** — there is **no password method to offer the user**, never present one.
   `node <skill-dir>/bin/login.mjs` requests a device code and **auto-opens the browser** to the code-prefilled
   `https://dev.nativeui.com/device?userCode=…` page, then polls until they approve. **ALWAYS paste the printed
   verification URL + the 8-char code to the user verbatim** in case the browser didn't auto-open; they approve
   in the browser where they're already signed in to `dev.nativeui.com`. The local session caches at
   `~/.nativeui/credentials.json` (0600) and auto-refreshes through profile-api.
2. **Optional override** — to target a non-default environment (self-host / prod), set the fields you want in
   `~/.nativeui/config.json` or `NATIVEUI_*` env vars (resolution: defaults ← file ← env, per-field). Not needed
   for the default dev backend.

### Auth preflight — ALWAYS FIRST
Before authoring, importing, or exporting, run the preflight gate and **STOP if it fails**:
```bash
node <skill-dir>/bin/preflight.mjs
```
On success it prints `ok: <email>, subscription active`. On failure it prints the exact remedy and exits
non-zero — **relay that message verbatim** and act on it. No config is needed (PUBLIC dev defaults are baked in):
- **not logged in / session expired** → run `login.mjs` (browser SSO), then re-run preflight.
- **no active subscription** → activate one on the account billing page, then re-run preflight.
- **config error** (rare) → only if a `~/.nativeui/config.json` / `NATIVEUI_*` override for another environment
  blanked a field; remove that override to use the baked default, or give it a real value.

## Golden rules (full spec in the skill's `references/authoring-rules.md`)

1. **Plain HTML/CSS only.** Embedded `<style>` + inline `style`. NO `<script>`, NO external/CDN stylesheets,
   NO `data-*` attributes (stripped on import) — those abort the import or get ignored. Structure = semantic
   HTML; layout + appearance = CSS, exactly as a browser renders it.
2. **Mobile-first, `412 × 915` default stage.** Author for 412px width first.
3. **Responsiveness = CSS `@media` width breakpoints** → become NativeUI smart divisions that re-resolve per
   device width (on the device too).
4. **Animations = `@keyframes` + `animation`** → become the NativeUI timeline (runs on the device).
5. **Stable, letter-first ids** (`id="login_button"`, never starting with a digit) so the backend gets a typed
   control accessor on both platforms.
6. **Multi-page** apps = one HTML document per screen; link screens with `<a href="#...">`. The target resolves
   by the destination screen's **title/name slug** (`<title>Trip Detail</title>` → `href="#trip-detail"`) or a
   **1-based page index** (`#page2` / `#2`), **NOT** an element id. `http/https/mailto/tel` hrefs become
   OPEN_URL. Nav resolves only in a ≥2-screen import and swaps screens on device with zero backend code.

## Workflow

### 0. Auth preflight — ALWAYS FIRST (above). STOP if it fails.

### 1. Intake source material when present
For PDFs, screenshots/images, Figma links or JSON, existing HTML/CSS, source files/folders, or URLs, run:
```bash
node <skill-dir>/bin/nui-intake.mjs <input...> -o nativeui-intake.json
```
Use the bundle's provenance, assets, breakpoints, source summaries, confidence, and `gaps[]`. Do not claim
visual fidelity through unresolved gaps.

If the source is a prompt, PDF/image/Figma/source/URL, or HTML that is plain/static/non-responsive, invoke
`nativeui-design` next. It creates `nativeui-design-guide.md`, asks concise responsiveness/portrait/landscape/UX
questions when needed, and turns the references into a styling guide, animation system, and responsive direction
before HTML authoring.

If the app needs a new backend, database, auth, local server, deployment plan, or existing backend audit, invoke
`nativeui-architect` before `nativeui-backend`. It writes `nativeui-architecture.md` and waits for approval
before any backend/deployment automation.

### 2. Plan the screens
From the user's idea, list the screens and key components per screen. Confirm the platform target (both iOS +
Android by default) and any responsive / animation / backend requirements.

For functionality work, load `nativeui-developer`: sync-check `project.json`, register API/database library
items, keep secrets in the account store, and wire matching Android/iOS connector classes.

For data-backed lists, use NativeUI's repeater model deliberately: plain HTML imports concrete rows, then the
project/editor can mark a container's children as a repeater template with `sampleItems` for preview. Register
the `api`/`database` data source and still wire live runtime data in both Android + iOS connectors.

### 3. Author HTML/CSS (one document per screen)
Write each screen as a complete standalone HTML document per `references/authoring-rules.md`. Use the files in
the skill's `examples/` as templates. Keep it mobile-first; add `@media` for responsiveness and `@keyframes`
for animation. Give every interactive/named element a stable, letter-first `id`.

### 4. Responsive audit before import
```bash
node <skill-dir>/bin/nui-responsive-audit.mjs home.html settings.html
```
Fix failures unless the user explicitly requested a fixed, non-responsive design.

### 5. Import → `project.json`
```bash
node <skill-dir>/bin/nui-import.mjs home.html settings.html -o project.json
```
One file argument per screen, in screen order; each page name comes from the HTML file's basename. The script
POSTs to `/export/import/html` with a fresh token and writes the returned project to `-o` (default
`./project.json`). If the service returns `errors[]`, it prints them and **writes nothing** — FIX the HTML/CSS
and re-import. Never hand-edit around an import error.

### 5b. Save / preview (optional, OFFER after auth / before export)
- **Save** to the user's NativeUI cloud account (opens in the desktop + web editors) — get a **name** first:
  ```bash
  node <skill-dir>/bin/nui-save.mjs project.json --name "My App" [--location "Folder"]
  ```
  Create-or-update by name (re-saving the same name updates it).
- **Preview** in the web companion editor before exporting (cloud-saves, prints the editor URL + name to open):
  ```bash
  node <skill-dir>/bin/nui-preview.mjs project.json --name "My App" [--open]
  ```

### 6. Export native iOS + Android
```bash
node <skill-dir>/bin/nui-export.mjs project.json --platform android -o ./android-out
node <skill-dir>/bin/nui-export.mjs project.json --platform ios     -o ./ios-out
```
Each writes `<outdir>/<platform>-export.zip` and unzips it in place when `unzip` is available. Add `--manifest`
to fetch only the file list. Clean/prod is the default runnable native project you ship; pass **`--beta`** only
for the internal parity capture harness. Hand off where the projects are and how to open/run them (Android
Studio / Xcode). **Offer to run it locally**:
```bash
node <skill-dir>/bin/nui-run.mjs project.json --platform both
```
That runs `nui-export --prod` then builds + launches the clean PROD app (animations auto-play, responsive
`@media` divisions resolve at device width, effects render, events/nav work) on the local Android emulator +
iOS simulator, skipping a platform gracefully if its toolchain/device is unavailable.

### 7. Wire backend (only if asked) — both platforms, connector classes
Plan connector classes first:
```bash
node <skill-dir>/bin/nui-connectors-plan.mjs project.json --human
```
Keep **`NuiBackend.kt` (Android) AND `NuiBackend.swift` (iOS)** as thin write-once delegators. Put durable
app/backend behavior in matching `*BackendConnector.kt` and `*BackendConnector.swift` classes. Use typed control
accessors + the `onScreenReady` / `onCallApi` / `onCallDatabase` / `onNavigateToStage` hooks; make the same
change on **both** codebases. **NEVER** edit any generated file (MainActivity, the `Generated*` /
`NuiScreenControls` / `NuiScreenDelegate`). Full rules + examples: `references/backend-contract.md`.

The backend code only *calls* a server. To plan that server (derive endpoints/databases/auth from the model +
detect your local toolchain + recommend a stack/deploy target):
```bash
node <skill-dir>/bin/nui-backend-plan.mjs project.json --human
```
Then scaffold + deploy the server with that plan (Node/Python/BaaS/Mock → Cloud Run / Fly / Vercel / VPS) and
point the app's base URL at it.

**Pin the contract with tests (offer after wiring).** Generate iOS XCTest + Android JUnit/Robolectric tests
that assert the NuiBackend contract (typed accessors resolve, `onScreenReady` fires, delegate hooks exist, a
smoke) so a future re-export or designer rename that breaks the surface fails loudly:
```bash
node <skill-dir>/bin/nui-test-gen.mjs project.json --platform both --out ./android-out --ios-out ./ios-out
```
These target the GENERATED contract surface only — never generated UI.

### 8. Final review before handoff
```bash
node <skill-dir>/bin/nui-final-review.mjs \
	  --project project.json \
	  --html home.html settings.html \
	  --intake nativeui-intake.json \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
  --android-dir ./android-out \
  --ios-dir ./ios-out \
  --human
```
Omit inputs that do not exist yet, but always include `--project` after import. Include the approved architecture
record when backend-required functionality exists. Fix non-zero errors before handoff. Pass the latest user
requirements as inline text or a path/`@path` file so explicit constraints are checked against the generated
project.

### 9. Iterate (smallest blast radius first — schema + safe-edit rules in `references/project-model.md`)
- **a) Direct `project.json` edit** — fastest, for a color/text/position/value or add/remove/reorder a node.
  The model round-trips as a strict fixpoint, so a *valid* hand-edit is safe: find the node by `id`, change the
  documented field (keep color `#rrggbb@alpha`, ids letter-first + unique, valid `kind`), then **always
  validate before export**:
  ```bash
  node <skill-dir>/bin/nui-validate.mjs project.json
  ```
  (`--structural` for the structural-only check.) Structural redesign, flex/grid/responsive/animation, and
  `nui.*` layout props should be re-authored, NOT forged — see `project-model.md` §9.
- **b) Granular fragment round-trip** — regenerate ONE component from HTML:
  ```bash
  node <skill-dir>/bin/nui-fragment-extract.mjs project.json --id trip_card -o card.html
  # edit card.html ...
  node <skill-dir>/bin/nui-fragment-import.mjs  card.html -o card-subtree.json
  ```
  `card-subtree.json` has `{ rootNodes, libraryItems }`. Replace the matching node in a stage's `rootNodes`
  (or a node's `children`) with the new `rootNodes`, merge `libraryItems` into the project, then `nui-validate`
  before export.
- **c) Full re-author + re-import** — for a structural change to a whole screen. Re-author its HTML/CSS and
  re-import with `nui-import.mjs` (round-trip-safe). Re-export regenerates the UI around the untouched
  `NuiBackend.*`, so backend code survives.

To see a change running, use `nui-run.mjs` (builds + launches the clean PROD app locally).

## Verifying your output

### The prod-quality guarantee
NativeUI's production quality comes from the **validated exporter**, not from anything you do per design. The
parity corpus holds the pipeline at **zero per-node deltas across editor == web == iOS == Android** for every
covered case, so a clean (`--prod`) export renders the design faithfully on both platforms **by construction**.
You do not verify this per app — you trust the validated exporter and keep the design inside the supported
surface (below).

- **clean/prod** = the default, idiomatic, runnable native project (no instrumentation). This is what you ship.
- **`--beta`** additionally ships parity **instrumentation** that lets a render delta be
  *measured* on a real design. When a beta render diverges from the editor, that is a **new exporter gap** —
  surface it with `node <skill-dir>/bin/nui-report-parity.mjs` (files the delta to the bugs API). That is how
  new gaps get found and fixed at the exporter; it is not something you patch in the app.

### Not supported / degrades — guard against silent drops
An unsupported CSS feature does **not** error on import — it is **silently dropped**, so a browser mockup can
look right while the imported app differs. Two defenses, both required:
1. **Author within the supported surface.** Follow `references/authoring-rules.md` and heed its **"Not supported
   / degrades"** section. Known drops/degrades to author around: `conic-gradient`, non-`uppercase`
   `text-transform`, `text-align:justify`, non-blur `filter` / `backdrop-filter` (only `filter: blur()` renders
   on all lanes), RTL, `em` sizing,
   per-corner `border-radius` longhands, `:nth-child`, remote `<img>`, `stroke-dashoffset`. Rewrite a mockup the
   supported way **before** importing.
2. **Treat import `errors[]` as hard failures.** When the importer returns `errors[]` (a `<script>`, an
   external stylesheet, malformed input), `nui-import.mjs` prints them and **writes nothing**. Never work around
   an import error by hand-editing `project.json` — fix the HTML/CSS and re-import.

## Reference docs (READ as needed — do not restate from memory)
Inside the installed skill (`<skill-dir>` = `~/.codex/skills/nativeui` by default; the installed `SKILL.md`
spells out the absolute paths):
- `references/authoring-rules.md` — the exact HTML/CSS surface, every NativeUI capability, and the full **"Not
  supported / degrades"** list.
- `references/backend-contract.md` — generated-vs-write-once files and the `NuiBackend` API.
- `references/project-model.md` — the `project.json` schema, references, page updates, safe-edit rules, and the
  toolchain commands.
- `examples/` — gold HTML/CSS screens to copy from (`responsive-animated-home.html`, `forms.html`,
  `svg-icons-shapes.html`, `effects-clip-transforms.html`, `borders.html`, `finance-dashboard.html`).
