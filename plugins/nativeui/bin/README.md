# NativeUI plugin toolchain (`bin/`)

Pure-Node (Node 18+) scripts the NativeUI skills call. No npm dependencies — they
use the global `fetch` and built-in modules only. Each script **fails closed**
with an actionable message and a non-zero exit when it can't proceed.

## Setup — none required, just sign in

**No configuration is needed.** `config.mjs` ships baked-in NativeUI dev hosts
(`https://dev.nativeui.com`, billing `…/api/billing`) and `exportAuthMode:
"nativeui"`. Identity-provider keys live server-side in `profile-api`; a normal
user configures **nothing**. The only setup step is a browser SSO sign-in (and
an active subscription):

```bash
node bin/login.mjs        # browser SSO — auto-opens the code-prefilled /device page
node bin/preflight.mjs    # should print: ok: <email>, subscription active
```

The local session (idToken / refreshToken / expiresAt) is cached at
`~/.nativeui/credentials.json` (mode 0600) and auto-refreshed through `profile-api`.
No Firebase/API key is stored in the plugin config or user config.

## Optional: override to a different environment

Config is **only** needed to point the toolchain at a non-default environment
(self-host / prod). Resolution is **defaults ← `~/.nativeui/config.json` ← `NATIVEUI_*`
env** (later wins per-field), so the file and env layers are per-field *overrides* of
the baked-in defaults. For the default dev backend, do nothing here.

For enterprise tenants that block external disclosure to `dev.nativeui.com`, do
not retry the denied upload. Use an admin-approved NativeUI policy allowlist, or
point `exportServiceUrl` at an approved internal/self-host export service and set
`exportAuthMode` to `"none"` only when that service intentionally accepts
unauthenticated export requests from the user's environment.

### A. Config file

Copy the blank template and set only the fields you want to change:

```bash
mkdir -p ~/.nativeui
cp bin/config.example.json ~/.nativeui/config.json
# then edit ~/.nativeui/config.json — set only the fields to override
```

`bin/config.dev.example.json` is a **filled reference** of the (default) dev values,
shown here so you can see the shape:

```json
{
  "exportServiceUrl": "https://dev.nativeui.com",
  "billingApiUrl": "https://dev.nativeui.com/api/billing",
  "exportAuthMode": "nativeui"
}
```

`exportServiceUrl` is the bare origin (the scripts append `/export/...`
themselves.
`billingApiUrl` ends in `/api/billing` (preflight appends `/subscription`).
`exportAuthMode` is `"nativeui"` by default. Use `"none"` only for an approved
internal/self-host export service; in that mode import/export/validation omit
the NativeUI bearer token, preflight skips login/subscription, and cloud account
features such as save, preview, project sync, library secrets, and parity reports
remain unavailable.

### B. Environment variables (override field by field)

```bash
export NATIVEUI_EXPORT_SERVICE_URL=https://<export-host>
export NATIVEUI_BILLING_API_URL=https://<billing-host>
export NATIVEUI_EXPORT_AUTH_MODE=nativeui
```

Export-only fallback example:

```json
{
  "exportServiceUrl": "https://nativeui-export.internal.example.com",
  "exportAuthMode": "none"
}
```

## Scripts

| Script | Purpose |
| --- | --- |
| `config.mjs` | Loads/merges config (file + env) and loads/saves credentials. Imported by the others; not run directly. |
| `login.mjs` | `nativeui login`. Starts browser SSO, receives a brokered CLI session from profile-api, caches creds, prints the signed-in email. |
| `logout.mjs` | `nativeui logout`. Removes the cached credentials (config is left in place). Idempotent. |
| `token.mjs` | Prints a **fresh** idToken to stdout (auto-refresh via profile-api). Non-zero if not logged in. |
| `preflight.mjs` | Gate every action runs first: logged in **and** subscription active. Prints `ok: <email>, subscription active`. |
| `nui-intake.mjs` | Normalizes messy inputs before authoring: prompt, HTML/CSS, folders/source, PDF, images, Figma URLs/JSON, and URLs → `nativeui-intake.json` with provenance, assets, breakpoints, confidence, and gaps. Pure Node; optional local/Figma tools only when available. |
| `nui-responsive-audit.mjs` | Audits HTML/CSS or `project.json` for a real responsive path before import/export: breakpoints, divisions, semantic responsive fields, fixed-width smells, overflow risks, and target coverage. Fails closed unless `--allow-static`. |
| `nui-design-guide.mjs` | Scaffolds/checks `nativeui-design-guide.md` for the design agent: source summary, responsive requirements, portrait/landscape layout, visual system, motion, UX states, accessibility, and NativeUI implementation notes. Pure Node, no network/auth. |
| `nui-import.mjs` | Imports HTML file(s) into a project: `node bin/nui-import.mjs a.html b.html -o project.json`. |
| `nui-validate.mjs` | Validates a `project.json` before export (run after a direct hand-edit): `node bin/nui-validate.mjs project.json [--structural]`. Authoritative model round-trip (when logged in, via the export service) + a structural check (well-formed JSON, version, `stages[].rootNodes[]`, valid `kind`, letter-first ids, type slips). Fails closed. |
| `nui-fragment-import.mjs` | Granular forward path: imports ONE HTML/CSS snippet into a NodeState subtree: `node bin/nui-fragment-import.mjs card.html -o subtree.json` → `{rootNodes, libraryItems}` to splice into a project. |
| `nui-fragment-extract.mjs` | Granular reverse path: extracts one node subtree from a project back to an HTML/CSS snippet: `node bin/nui-fragment-extract.mjs project.json --id trip_card -o card.html`. Edit, then re-import with `nui-fragment-import.mjs`. |
| `nui-project-sync.mjs` | Guarded cloud sync for `project.json`: `status` detects local/cloud conflicts, `pull` downloads the cloud copy, and `push` sends `expectedRevision` so web/desktop edits are not overwritten. Writes `<project.json>.nativeui-sync.json`. |
| `nui-library.mjs` | Registers API/database library items in `project.json` (`upsert-api`, `upsert-database`) and uses account-side secret endpoints for credentials (`put-secret --secret-stdin`, `secret-status`, `test`). Secrets never go in `project.json`. |
| `nui-preview.mjs` | Previews a project before export: cloud-saves it (create-or-update by name) and prints the web companion editor URL + the name to open from "Open from cloud": `node bin/nui-preview.mjs project.json --name "My App" [--open]`. The editor host is `webapp.<env>` of `exportServiceUrl`. `--no-save` = local-only note (uploads nothing; exits non-zero — no live preview without a save). Fails closed on missing config/auth. |
| `nui-export.mjs` | Exports a project to native: `node bin/nui-export.mjs project.json --platform android -o out [--manifest] [--beta]`. Clean/prod is the default runnable app; `--beta` (or `--mode beta`) is only for the internal capture harness. Supports app identity/version/platform flags such as `--app-name`, `--android-package`, and `--ios-bundle-id`. Unzips with `unzip`, else `python3 -m zipfile`, else `tar`; if none, leaves the `.zip`. |
| `nui-test-gen.mjs` | Generates contract tests for an EXPORTED app (iOS XCTest + Android JUnit/Robolectric) asserting the NuiBackend contract — typed accessors compile/resolve, `onScreenReady` fires, the delegate hooks exist, a smoke: `node bin/nui-test-gen.mjs project.json --platform both --out ./android-out --ios-out ./ios-out`. Derives accessor names exactly as the exporters do. Pure Node, no network/auth. Skill: **nativeui-test**. |
| `nui-architecture.mjs` | Scaffolds/checks `nativeui-architecture.md` for the architect agent, including backend/deploy/local-run/repo/secret/native-wiring sections and approval enforcement with `--require-approved`. Pure Node, no network/auth. |
| `nui-connectors-plan.mjs` | Plans durable backend connector classes from `project.json`: controls, interactions, endpoints, DB calls, and Android/iOS target paths. `NuiBackend.*` stays a thin delegator; app/backend logic belongs in `*BackendConnector.*`. Pure Node, no network/auth. |
| `nui-final-review.mjs` | Final design review gate for agents: checks import surface, responsiveness, project validity, explicit instruction contradictions, no-runtime events, approved architecture for backend-required work, connector usage, and backend logic in `NuiBackend.*`. Fails non-zero on errors. Skill: **nativeui-review**. |
| `nui-run.mjs` | Builds + installs + LAUNCHES the clean prod app on the local Android emulator / iOS simulator: `node bin/nui-run.mjs project.json --platform both` (exports `--prod` first), or `--project <exported-dir>` to skip export. Detects toolchains/devices, boots one if needed, and skips a platform gracefully when its toolchain/device is absent (prints the Android Studio / Xcode fallback). |

## Typical flow

```bash
node bin/login.mjs
node bin/preflight.mjs
node bin/nui-intake.mjs ./source-or-figma-or-pdf -o nativeui-intake.json
node bin/nui-design-guide.mjs init -o nativeui-design-guide.md --source nativeui-intake.json
node bin/nui-responsive-audit.mjs home.html settings.html
node bin/nui-import.mjs home.html settings.html -o project.json
node bin/nui-validate.mjs project.json          # after any direct edit, before export
node bin/nui-project-sync.mjs status project.json --name "My App" --human
node bin/nui-library.mjs upsert-api project.json --name login --path /api/login --method POST
node bin/nui-architecture.mjs init -o nativeui-architecture.md --project project.json
# After the user approves the architecture record:
node bin/nui-architecture.mjs check nativeui-architecture.md --require-approved
node bin/nui-connectors-plan.mjs project.json --human
node bin/nui-final-review.mjs --project project.json --html home.html settings.html --intake nativeui-intake.json --architecture nativeui-architecture.md --instructions user-instructions.md --human
node bin/nui-export.mjs project.json --platform android -o ./android-out
node bin/nui-export.mjs project.json --platform ios     -o ./ios-out
# Optional: preview in the web editor before exporting (cloud-saves + prints the editor URL):
node bin/nui-preview.mjs project.json --name "My App"
# Guarded cloud push after edits:
node bin/nui-project-sync.mjs push project.json --name "My App"
# Run the real prod app on the local emulator + simulator:
node bin/nui-run.mjs project.json --platform both -o ./nui-run-out
# Generate contract tests for the exported app (skill: nativeui-test):
node bin/nui-test-gen.mjs project.json --platform both --out ./android-out --ios-out ./ios-out
```

## Self-tests

The toolchain has its own pure-Node test suite (`../test/`, run with `npm test` or
`node test/run.mjs` from the plugin root) covering config merge/precedence, each command's
arg-parsing + fail-closed guards (no network), and `nui-validate` structural validation. CI
(`.github/workflows/plugin-ci.yml`) runs `node --check` on every `bin/*.mjs` + the suite on Node 18/20.

## Remedies (what the fail-closed messages tell you)

- Not signed in / session expired → `node bin/login.mjs` (browser SSO).
- No active subscription → activate one on your account billing page, then retry.
- Config error (rare — only if an override blanked a field) → remove the offending entry in
  `~/.nativeui/config.json` / `NATIVEUI_*` to fall back to the baked-in default, or give it a real value.
