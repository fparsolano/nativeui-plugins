---
name: nativeui-developer
description: >-
  Codex-first NativeUI developer agent for implementing app functionality across the full NativeUI native
  surface. Use when a user asks to add or change behavior, connect APIs/databases, handle login/forms/taps,
  sync or save project.json, review native parity, or build a mobile app. Enforces that mobile means both
  iOS and Android, web export is unsupported for v1, API/database definitions are registered as NativeUI
  library items, secrets live in the user's account secret store, project.json is cloud-sync guarded, and
  every functionality change is wired identically into all native exports.
metadata:
  argument_hint: "[project.json or app request] [functionality request]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-developer` inside the installed plugin source before running commands.



# NativeUI developer agent

Codex is the source of truth for this developer-agent behavior. Claude Code mirrors this skill; if the two ever
disagree, update the Claude mirror from this Codex-owned contract.

Use this skill as the orchestrator for functionality requests. The lower-level skills still do the work:
`nativeui` / `nativeui-app` author and export apps, `nativeui-update` changes screens, `nativeui-connect` wires
on-device connectors, `nativeui-architect` chooses/audits backend and deployment shape, `nativeui-backend`
scaffolds the server, `nativeui-test` pins generated contracts, and `nativeui-review` runs the final gate.

## Non-negotiable rules

1. **Mobile means both native targets.** If the user asks for mobile, app, native app, iPhone, Android, iOS, or
   functionality in an app, implement and verify both Android and iOS unless they explicitly narrow the work.
2. **Web is unsupported for v1.** If the user asks for web, website, React, Vue, vanilla JS, or browser export,
   state that NativeUI currently supports mobile native export only and ask whether to proceed as iOS + Android.
   Do not choose a web framework or promise a web export.
3. **Functionality must connect to every native export.** Any login, button tap, form submit, API call,
   database call, persistence behavior, state mutation, or navigation side effect must be reflected in both
   `*BackendConnector.kt` and `*BackendConnector.swift`, with `NuiBackend.kt` / `NuiBackend.swift` kept thin.
4. **Generated files are read-only.** Never edit `MainActivity`, `Generated*`, `NuiScreenControls`,
   `NuiScreenDelegate`, layout XML, drawables, or generated Swift factories to add behavior.
5. **APIs and databases are registered in NativeUI.** Backend-routed behavior must target `libraryItems[]`
   entries with `assetType: "api"` or `"database"` and non-secret `configJson`. Use
   `nui-library.mjs upsert-api` / `upsert-database`; do not invent ad hoc endpoint constants as the source of
   truth.
6. **Secrets live in the user's account.** API keys, bearer tokens, basic auth passwords, and database passwords
   go through `nui-library.mjs put-secret --secret-stdin`, which stores them in the account-scoped project
   secret endpoint. Never place secrets in `project.json`, source files, command arguments, logs, generated
   native code, or docs.
7. **project.json must be sync guarded.** Before mutating an existing cloud-backed project, run
   `nui-project-sync.mjs status`. If local and cloud both changed, stop and ask whether to pull cloud, keep
   local as a new draft, or manually merge. Use guarded `push`/`pull` to update the sidecar metadata.
8. **Tool auth is SSO/session-only.** Do not ask the user for Firebase, identity-provider, or NativeUI service
   API keys to operate the plugin. The CLI session is brokered by profile-api; local config should only override
   service URLs for non-default environments.
9. **Repeaters use data adapters for source mapping.** A repeater marks a container's children as an item
   template and expands preview rows from `repeater.sampleItems`, `repeater.dataSource`, or its referenced
   `dataAdapters[]` entry. The adapter points at a registered `api`/`database` library item, names the
   result/collection path, and maps source fields into `{{item.*}}` placeholders. Live runtime data still
   requires matching Android and iOS connector behavior; native exports expose fixed preview row pools through
   `controls.bindRepeater("<adapter-or-source-id>", rows)` so connectors do not hand-wire generated `__rN`
   controls for ordinary adapter-backed lists.

## Workflow

1. **Preflight.** Run the NativeUI auth/subscription preflight before import/export/cloud work:
   ```bash
   node <bin>/preflight.mjs
   ```
   If not logged in, run `login.mjs` and paste the printed verification URL + code.

2. **Classify the request.**
   - Mobile/app/functionality -> both iOS + Android.
   - Web -> unsupported for v1; ask whether to proceed as mobile.
   - Design-only tweak -> use `nativeui-update`, but still sync guard if cloud-backed.
   - Behavior/API/database -> continue through all steps below.

3. **Sync guard.** If the project has a cloud name/id or a `.nativeui-sync.json` sidecar, run:
   ```bash
   node <bin>/nui-project-sync.mjs status project.json --name "Project Name" --human
   ```
   On conflict, stop. Pull only if the user chooses cloud as the source.

4. **Register API/database surfaces.** Add or update library items before connector code:
   ```bash
   node <bin>/nui-library.mjs upsert-api project.json --name login --path /api/login --method POST
   node <bin>/nui-library.mjs upsert-database project.json --name trips --connector postgresql --table trips
   ```
   Store secrets only through stdin:
   ```bash
   printf '%s' "$SECRET_VALUE" | node <bin>/nui-library.mjs put-secret \
     --project-id <cloud-project-id> --item-id <library-item-id> --kind api --secret-stdin
   ```
   Do not echo real secrets in conversation; ask the user to run the command locally when needed.
   For data-backed repeaters, create or update a project `dataAdapters[]` entry, align `repeater.dataSource`,
   set `repeater.adapterId`, and provide non-secret adapter or repeater `sampleItems` for preview. Do not put
   secrets in adapters; live fetches still belong in connector classes, which call the generated
   `controls.bindRepeater(...)` helper for fixed preview row pools.

5. **Wire both native targets.**
   - Run `nui-connectors-plan.mjs project.json --human`.
   - Implement or update matching `*BackendConnector.kt` and `*BackendConnector.swift` classes.
   - Keep `NuiBackend.*` as delegation/registration only.
   - If a required id is missing or digit-first, fix the design with `nativeui-update`, re-import, and re-export
     both platforms.

6. **Architecture + backend server, if needed.** If the app needs a server, invoke `nativeui-architect` unless
   an approved `nativeui-architecture.md` already exists. The architect audits existing code, asks how the
   backend should run locally, asks where it should eventually deploy and live in repos, writes the architecture
   decision, and waits for approval. Verify approval with
   `nui-architecture.mjs check nativeui-architecture.md --require-approved`. After approval, run
   `nui-backend-plan.mjs project.json --human`,
   scaffold/deploy with `nativeui-backend`, and point both connector implementations at the same route contract.

7. **Validate and save.**
   - `nui-validate.mjs project.json`
   - Export or run both native targets.
   - Generate contract tests when behavior was wired:
     `nui-test-gen.mjs project.json --platform both --out ./android-out --ios-out ./ios-out`
   - Push cloud changes with `nui-project-sync.mjs push` so revision metadata is refreshed.

8. **Final review.** Always run:
   ```bash
   node <bin>/nui-final-review.mjs \
     --project project.json \
	 --android-dir ./android-out \
	 --ios-dir ./ios-out \
	 --architecture nativeui-architecture.md \
	 --instructions user-instructions.md \
	 --human
   ```
   The review must fail if functionality is not mirrored across Android and iOS, if API/database actions lack
   library items, if backend-required work lacks approved architecture, if generated files contain app logic, if
   connector coverage is one-sided, or if a data-backed list/repeater bypasses registered library items and
   connector parity.
