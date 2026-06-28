# NativeUI plugin for Claude Code

Teaches Claude to author complete **native iOS + Android apps** with NativeUI from a natural-language prompt.
Claude writes **plain HTML/CSS**, imports it to a NativeUI **project** (`project.json`), and exports native
screens — leveraging NativeUI for responsiveness, animations, navigation, forms, charts, and data-list
repeaters. Backend logic (APIs, database, events) is wired through the generated **`NuiBackend`** interface, never by editing
generated UI.

Everything targets the **dev** environment (`dev.nativeui.com`) by default.

Source of truth: NativeUI developer-agent behavior is **Codex-first**. The canonical contract lives in
`../nativeui-codex/canonical/nativeui-developer/SKILL.md`; this Claude plugin mirrors it, and parity tests fail
if the mirror drifts.

Plan + roadmap: `docs/nativeui-plugin-plan.md` (§10 = the canonical tracked build plan). Skill-coverage gap
inventory: `docs/nativeui-plugin-skill-gaps.md`.

## What's here
```
nativeui-plugin/
├── .claude-plugin/plugin.json
├── DOGFOOD.md                          # end-to-end release smoke checklist (login→author→export→run→connect→update)
├── bin/                                # pure-Node (18+) toolchain, no npm deps — see bin/README.md
│   ├── config.mjs                      # baked-in PUBLIC dev defaults (zero-config); file/env are optional overrides
│   ├── login.mjs                       # sign in: browser SSO device-flow — auto-opens + pastes the code-prefilled /device link
│   ├── logout.mjs                      # remove cached credentials
│   ├── token.mjs                       # print a fresh idToken (auto-refresh)
│   ├── preflight.mjs                   # fail-closed gate: logged in AND subscription active
│   ├── nui-intake.mjs                  # prompt/PDF/image/Figma/source/HTML intake → provenance + gaps
│   ├── nui-responsive-audit.mjs        # fail-closed responsive path audit for HTML/project.json
│   ├── nui-import.mjs                  # HTML file(s) → project.json (cloud export-service)
│   ├── nui-validate.mjs                # structural + model round-trip check on a project.json (fail-closed)
│   ├── nui-fragment-import.mjs         # import an HTML/CSS snippet → a subtree to splice into project.json
│   ├── nui-fragment-extract.mjs        # extract a subtree of project.json back to HTML/CSS for granular re-edit
│   ├── nui-preview.mjs                 # cloud-save + open in the web companion editor before export
│   ├── nui-project-sync.mjs            # cloud revision status/pull/guarded push for project.json
│   ├── nui-library.mjs                 # API/database library registration + account-side secret operations
│   ├── nui-design-guide.mjs            # scaffold/check nativeui-design-guide.md for design-agent handoff
│   ├── nui-export.mjs                  # project.json → native Android/iOS ZIP (clean/prod default; --beta = capture harness)
│   ├── nui-backend-plan.mjs            # derive backend endpoints/DB/repeaters/auth from project.json + detect toolchain → recommend a stack (local, no auth)
│   ├── nui-architecture.mjs            # scaffold/check nativeui-architecture.md and approval before backend work
│   ├── nui-connectors-plan.mjs         # plan durable *BackendConnector.* classes + thin NuiBackend delegation
│   ├── nui-final-review.mjs            # final agent review: validity, responsiveness, architecture, events, connectors
│   ├── nui-test-gen.mjs                # exported app → iOS XCTest + Android JUnit/Robolectric contract tests
│   ├── nui-run.mjs                     # build + install + LAUNCH the clean prod app on local emulator/simulator
│   ├── nui-save.mjs                    # save project.json to the cloud account (create-or-update by name)
│   ├── nui-report-parity.mjs           # report a parity delta to the bugs API (beta telemetry)
│   ├── config.dev.example.json        # filled reference of the (default) dev values — only for an override
│   └── config.example.json            # blank override template (target another environment)
├── test/                               # pure-Node self-tests (node:test) — `npm test` / `node test/run.mjs`
│                                       #   (CI: .github/workflows/plugin-ci.yml — self-tests + `node --check`, Node 18/20)
└── skills/
    ├── nativeui/                       # the core playbook: auth → author → import → export → connect → iterate
    │   ├── SKILL.md
    │   ├── references/
    │   │   ├── authoring-rules.md       # the exact HTML/CSS surface: mapping table + recipes (forms, tables,
    │   │   │                            #   lists/repeaters, scrolling, nav chrome, charts), depth (grid/gradients/SVG/
    │   │   │                            #   fonts/positioning), + a "Not supported / degrades" section
    │   │   ├── backend-contract.md      # generated-vs-write-once + the NuiBackend API + the full interaction
    │   │   │                            #   (trigger/action) vocabulary, both platforms
    │   │   └── project-model.md         # project.json schema, references, page updates, accessibility, toolchain
    │   └── examples/                    # gold HTML/CSS templates to copy from
    │       ├── responsive-animated-home.html
    │       ├── effects-clip-transforms.html   # circular avatar, dashed border, inset shadow, blur, clip-path
    │       ├── forms.html                       # labeled inputs, textarea, select, radio, checkbox, range
    │       ├── svg-icons-shapes.html            # line/fill icons (currentColor), shapes, linearGradient, clipPath, SVG text, ring
    │       ├── borders.html                     # multi-stroke (concentric) ring, solid/dashed/dotted, per-side, per-corner radius
    │       ├── finance-dashboard.html           # full app screen: pinned bars + scroll body, cards, SVG area chart, tx list
    │       └── README.md
    ├── nativeui-intake/SKILL.md        # normalize PDF/image/Figma/source inputs + responsive audit before import
    ├── nativeui-design/SKILL.md        # design agent: styling guide, UX, animation, responsive direction
    ├── nativeui-developer/SKILL.md     # Codex-canonical functionality rules mirrored into Claude
    ├── nativeui-architect/SKILL.md     # backend/deployment architecture gate before scaffolding
    ├── nativeui-app/SKILL.md           # build a full multi-screen app end-to-end
    ├── nativeui-import/SKILL.md        # import existing HTML/CSS → project.json (standalone step)
    ├── nativeui-export/SKILL.md        # export an existing project.json → native iOS/Android (standalone step)
    ├── nativeui-run/SKILL.md           # build + launch the clean prod app on the local emulator / simulator
    ├── nativeui-connect/SKILL.md       # plan connectors + wire thin NuiBackend.{kt,swift} delegation
    ├── nativeui-review/SKILL.md        # final design review gate before handoff
    ├── nativeui-backend/               # stand up + deploy the SERVER the app talks to (derive endpoints → scaffold → deploy)
    │   ├── SKILL.md
    │   ├── references/backend-deployment.md   # base-URL wiring (ATS/cleartext, localhost vs 10.0.2.2) + deploy-target matrix
    │   └── templates/                  # runnable scaffolds: node-hono/ python-fastapi/ baas/{supabase,firebase} mock-local/ + deploy/{cloud-run,fly-railway-render,vercel-netlify,docker-vps}
    ├── nativeui-test/SKILL.md          # generate iOS XCTest + Android JUnit/Robolectric NuiBackend-contract tests
    └── nativeui-update/SKILL.md        # round-trip-safe re-authoring of a single screen
```

A marketplace manifest lives at the repo root (`.claude-plugin/marketplace.json`) so the plugin can be
installed without `--plugin-dir` — see **Install** below.

## Setup — none, just sign in (SSO)

**No configuration is needed.** The toolchain ships baked-in NativeUI dev hosts, and identity-provider keys
stay server-side in `profile-api`, so a normal user configures nothing — they just sign in. The only
requirements are **NativeUI beta access**, a **browser SSO sign-in**, and an **active subscription**;
`nui-import.mjs` / `nui-export.mjs` fail closed until you're signed in with a subscription.

```bash
node nativeui-plugin/bin/login.mjs        # browser SSO — the only setup step (see "Signing in")
node nativeui-plugin/bin/preflight.mjs    # should print: ok: <email>, subscription active
```

**Optional override (only for a different environment).** To point the plugin at a non-default environment
(self-host / prod), copy `bin/config.example.json` to `~/.nativeui/config.json` and set the fields you want to
change (or set the `NATIVEUI_*` env vars); `bin/config.dev.example.json` is a filled reference of the default
dev values. Resolution is **defaults ← `~/.nativeui/config.json` ← `NATIVEUI_*` env** (per-field). Full
reference: [`bin/README.md`](bin/README.md). The local session is cached at `~/.nativeui/credentials.json`
(mode 0600) and auto-refreshed through `profile-api`.

**Tenant-policy fallback.** Plugin install cannot override an enterprise disclosure denial. If the tenant blocks
uploads to `dev.nativeui.com`, either use the admin policy kit in the Codex package to approve that destination,
or point `exportServiceUrl` at an approved internal/self-host export service and set
`exportAuthMode: "none"`. Export-only mode skips NativeUI login/subscription only for import/export/validation;
cloud account features still require hosted NativeUI auth.

### Signing in
Sign-in is **browser SSO only** (`node bin/login.mjs`, no flag): it requests a device code and **auto-opens your
browser** to the verification page with the code **pre-filled** (`https://dev.nativeui.com/device?userCode=…`),
then polls until you approve in the browser where you're already signed in. The skill also pastes the URL + code
so you can open it manually if the browser didn't pop. No password on the command line.

### Save to the cloud (optional)
Once authed and a `project.json` exists, save it to your NativeUI account (opens in the desktop + web editors):
```bash
node nativeui-plugin/bin/nui-save.mjs project.json --name "My App" [--location "Folder"]
```
Create-or-update by name — re-saving the same name updates the existing cloud project.

## Install

**Option A — marketplace (persistent).** From the NativeUI repo root (where `.claude-plugin/marketplace.json`
lives):
```
/plugin marketplace add ./
/plugin install nativeui@nativeui-marketplace
```

**Option B — load a directory (one session, good for iterating):**
```bash
claude --plugin-dir ./nativeui-plugin
# after editing a SKILL.md or a bin script:  /reload-plugins
```

Then just describe what you want, e.g.:

> "make me a responsive mobile-first habit-tracker app with a couple of subtle animations"

The `nativeui` skill auto-invokes, or invoke a skill explicitly (skills are namespaced under the plugin):
`/nativeui:nativeui`, `/nativeui:nativeui-developer`, `/nativeui:nativeui-app`, `/nativeui:nativeui-import`,
`/nativeui:nativeui-export`, `/nativeui:nativeui-run`, `/nativeui:nativeui-intake`, `/nativeui:nativeui-connect`,
`/nativeui:nativeui-design`, `/nativeui:nativeui-architect`, `/nativeui:nativeui-review`,
`/nativeui:nativeui-backend`, `/nativeui:nativeui-update`.

## Status / roadmap
**Done:**
- **Skill knowledge** — the `nativeui` skill + reference docs (authoring-rules with recipes + depth + a
  "Not supported / degrades" section, the full NuiBackend + interaction contract, the project model) + gold
  examples. Verified against the real importer/exporter.
- **Auth + cloud toolchain** — `login.mjs` (browser **SSO device-flow** only; auto-opens + pastes the code-prefilled link; profile-api brokers the CLI session so no identity-provider keys live locally) →
  cached/refreshable session; fail-closed `preflight.mjs` (logged in **and** subscription active); cloud
  `nui-import.mjs` / `nui-export.mjs`; **`nui-save.mjs`** (cloud-save); **`nui-project-sync.mjs`** (revision
  status/pull/guarded push); **`nui-library.mjs`** (API/database library registration + account-side secret
  operations); **`nui-report-parity.mjs`** (parity telemetry client). All endpoints default to
  `dev.nativeui.com`.
- **Driving skills** — `nativeui-app` (full author→import→export pipeline), `nativeui-import` / `nativeui-export`
  (standalone steps), `nativeui-run` (build + launch the clean prod app on the local emulator / simulator),
  `nativeui-intake` (PDF/image/Figma/source intake + responsive audit), `nativeui-design` (design agent for
  styling guide, UX, animation, and responsive direction before authoring), `nativeui-developer` (Codex-canonical
  functionality orchestration mirrored into Claude), `nativeui-architect` (backend/deployment architecture gate:
  audit existing repos, ask local run/deploy/repo choices, write/check `nativeui-architecture.md`, wait for
  approval),
  `nativeui-connect` (durable connector classes with thin
  `NuiBackend.{kt,swift}` delegation), `nativeui-review` (final design gate for validity, responsiveness,
  repeaters, events, and connector boundaries), `nativeui-update` (round-trip-safe single-screen re-author).
- **Clean / prod export (end-to-end)** — `-Dnui.export.mode=prod` emits a clean idiomatic native project (no
  parity instrumentation, parameterized bundle-id/app-name/version/package) that **runs the animation + responsive
  runtimes on device**; clean/prod is now the default, and `--beta` is only for parity capture. Plumbed through the
  export-service (`POST /export/<platform>?mode=prod`) and `nui-export`. iOS clean export now emits a
  shared runnable `<App>.xcscheme` so `xcodebuild -sdk iphonesimulator` builds it.
- **Local run** — `nui-run.mjs` builds + installs + **launches** the clean prod app on the local Android emulator
  and iOS simulator (verified end-to-end: animations play, `@media` divisions resolve at the device width,
  shadow/gradient effects render, `<a href>` nav present), skipping a platform gracefully when its toolchain or
  device is unavailable.
- **Marketplace manifest** shipped (`.claude-plugin/marketplace.json`, schema-pinned) + plugin manifest
  (`displayName`/`category`/`keywords`).
- **Backend wiring (Track E)** — `nativeui-connect` enumerates named controls (→ typed accessors) + authored
  interactions from `project.json`, runs `nui-connectors-plan.mjs`, and keeps `NuiBackend.{kt,swift}` as thin
  write-once delegators while app/backend logic lives in durable `*BackendConnector.{kt,swift}` classes;
  `backend-contract.md` documents **state & data**, **repeaters**, **secrets** (no hardcode; Keychain / EncryptedSharedPreferences),
  and **accessibility** (`<img alt>` imports as the label; `aria-*`/`role` don't — set non-image labels in connectors).
- **Backend SERVER scaffolding + deploy** — `nativeui-backend` skill + **`nui-backend-plan.mjs`** (pure-Node,
  no-auth) **derive** the server surface (endpoints from `CALL_API`/`SUBMIT_FORM`, DB ops from `CALL_DATABASE`,
  repeater data sources, auth needs) from `project.json`, **detect** the local toolchain, and **recommend** a stack. Ships runnable
  scaffolds (Node/Hono, Python/FastAPI, BaaS Supabase/Firebase, zero-dep Mock) + deploy recipes (Cloud Run,
  Fly/Railway/Render, Vercel/Netlify, Docker-on-VPS) and a `backend-deployment.md` that wires `NuiBackend.*` at
  the base URL (iOS ATS / Android cleartext for dev, HTTPS for prod). The on-device half stays in
  `nativeui-connect`; this is the other half — the server those calls hit.
- **Iteration & quality (Track F)** — `nativeui-update` (round-trip-safe single-screen re-author; `NuiBackend.*`
  survives) + the **prod-quality story** in SKILL "Verifying your output" (validated exporter = the guarantee;
  beta + `nui-report-parity` = the new-gap loop) + **unsupported-feature detection** (author within
  authoring-rules' "Not supported / degrades"; treat import `errors[]` as hard failures).
- **Packaging (Track G)** — marketplace/plugin manifests polished; `DOGFOOD.md` release smoke checklist.
- **Dev backend deployed** — the CLI SSO device-auth (`profile-api`) + parity-bugs (`bugs-api`) endpoints are
  **live on the dev stack** (device-code → 201, bugs ingest → 401-without-auth), so `login --sso` works against
  `dev.nativeui.com`. *(The `/device` browser verification page deploys with the next Firebase Hosting run —
  see Deferred.)*
- **Granular editing** — direct `project.json` editing backed by the **complete schema** in `project-model.md`,
  a fail-closed **`nui-validate`** (structural + model round-trip), and **fragment import/extract**
  (`nui-fragment-import` / `nui-fragment-extract`) to re-edit a single subtree as HTML/CSS.
- **Preview** — `nui-preview` cloud-saves and opens the project in the web companion editor before export.
- **Tests & CI** — `nui-test-gen` + the `nativeui-test` skill generate iOS XCTest + Android JUnit/Robolectric
  **NuiBackend-contract** tests for the exported app; **136 plugin self-tests** (`nativeui-plugin/test/`,
  `node:test`, fail-closed coverage for every network command) run in CI (`.github/workflows/plugin-ci.yml`,
  Node 18/20) alongside `node --check` on every bin.

**Deferred (post-MVP polish, non-blocking):**
- **Clean-export increment-2** — app icon, launch/splash screen, release signing config, `Generated*`→conventional
  class renames, iOS asset-catalog, and renaming the now-inert `PARITY_*` env keys to neutral product names.
  *(Runnable iOS scheme + a device-level emulator/simulator run confirming the prod app animates are **done** —
  see Local run.)*
- **`/device` page** — ships on the next Firebase Hosting deploy (the API behind it is already live).
- **Verification gaps** — the cloud `nui-export --prod` round-trip is source-read (covered by the unchanged beta
  export tests); the generated-app contract tests are structurally verified (executing them needs the exported
  native project + Gradle/Xcode).

The reference docs mirror the repo's authoritative `docs/html-format.md` + `docs/native-backend-contract.md`;
keep them in sync (or generate them) so they don't drift from the real importer/exporter.
