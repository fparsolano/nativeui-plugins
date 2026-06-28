---
name: nativeui-update
description: >-
  Make a round-trip-safe change to ONE screen of an existing NativeUI app and re-export. Use when the user
  asks to edit/update/change/tweak/redesign a single screen — change its layout, colors, text, add a
  component, fix spacing, adjust an animation or responsive breakpoint — without disturbing other screens
  or the backend. Handles updated PDF/image/Figma/source inputs, audits responsiveness, re-authors that
  screen's HTML/CSS, re-imports to refresh project.json, and re-exports both platforms; NuiBackend delegators
  and backend connector classes survive untouched.
metadata:
  argument_hint: "[project.json] [screen] [change]"
allowed-tools: "Bash(node <bin>/*) Bash(node <bin>/*) Read Write Edit Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-update` inside the installed plugin source before running commands.



# Update one NativeUI screen (round-trip-safe)

Change a single screen and re-export without breaking the rest of the app or the backend. The sanctioned path
is **re-author the screen's HTML/CSS → re-import → re-export** — never hand-edit `project.json` to make a
structural change. `<bin>` = `<bin>`.

## 1. Preflight — stop on failure
```bash
node <bin>/preflight.mjs
```
Relay the remedy and stop on any non-zero exit.

## 2. Sync guard before local edits
If this project has been saved to the NativeUI account, or there is a `.nativeui-sync.json` sidecar next to
`project.json`, poll the cloud copy before changing files:
```bash
node <bin>/nui-project-sync.mjs status project.json --name "Project Name" --human
```
If local and cloud both changed, stop and ask whether to pull the cloud copy, keep local as a new draft, or
manually merge. Do not overwrite visual tweaks the user may have made in the web or desktop editor.

## 3. Identify the target screen
Read the `project.json` argument (default `./project.json`). Match the `[screen]` argument to a stage by
`stageId` or `name`. Confirm the screen and the requested `[change]` with the user if ambiguous. Note its
`stageId` (becomes the re-authored file basename) and the ids of any nodes the backend/connectors may wire —
keep those **ids stable** so typed accessors and interactions survive.

If the change is based on new source material (PDF, screenshot/image, Figma, source code, HTML/CSS, URL), run
intake before re-authoring:
```bash
node <bin>/nui-intake.mjs <input...> -o nativeui-intake.json
```

If the update is a redesign/polish request, uses non-HTML source material, or the existing HTML is plain/static
or non-responsive, invoke `nativeui-design` before re-authoring. It should update `nativeui-design-guide.md`,
ask any needed responsiveness/portrait/landscape/UX questions, and produce the styling guide, animation, and
responsive layout direction for this one screen while preserving backend-wired ids.

## 4. Re-author that screen's HTML/CSS
Produce the updated standalone HTML document for ONLY that screen, per
`<this-skill>/../nativeui/references/authoring-rules.md`: plain HTML/CSS only (no `<script>`, no external
stylesheets, no `data-*`); mobile-first 412 × 915; `@media` for responsiveness; `@keyframes` for animation;
stable letter-first ids; `<title>` = screen name. Save it as `<stageId>.html`. Preserve the ids and `<title>`
of nodes that are wired in `NuiBackend.*` unless the user explicitly wants them renamed. If
`nativeui-design-guide.md` exists, follow its styling guide and responsive UX direction for the changed screen.

## 5. Audit responsiveness
Before re-importing, audit the updated screen HTML:
```bash
node <bin>/nui-responsive-audit.mjs <stageId>.html
```
Fix failures unless this screen is explicitly intended to be fixed/static. If the whole project already has
smart divisions, audit the project again after import too.

## 6. Re-import to refresh `project.json`
Re-import the **full screen set** so the project is regenerated with the updated screen in place. Re-authoring is
isolated to the one file, but `nui-import.mjs` builds the whole project from the HTML files you pass — so pass
**every** screen's HTML (the changed one plus all the unchanged ones) in the **original screen order**, or any
omitted stage is dropped from the project:
```bash
node <bin>/nui-import.mjs home.html updated-screen.html settings.html -o project.json
```
The durable artifact is the **per-screen HTML** — keep each screen's `.html` alongside `project.json` so this
re-import is always one command. If you only have the one changed `.html` on disk, first regenerate the others
back to HTML (one `nui-fragment-extract.mjs --id <stageRootId>` per screen, or keep them from the original
author step). If the service returns `errors[]`, the script **writes nothing** (it exits non-zero before writing)
— fix the HTML and re-import; never hand-edit around an import error.

> A direct `project.json` edit is acceptable ONLY for a trivial scalar change (one label's text, one color):
> find the node by `id`, change the scalar field, keep the `#rrggbb@alpha` color format. Anything structural
> goes through re-author + re-import.

## 7. Re-export both platforms — backend survives
Export **into the existing project directories** so the write-once backend files are preserved in place:
```bash
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```
**Why this is round-trip-safe:** the exporter regenerates the UI + the contract (`MainActivity`/`Generated*`,
`NuiScreenControls`, `NuiScreenDelegate`, `GeneratedInteractions`) every export, but `NuiBackend.kt` /
`App/NuiBackend.swift` are scaffolded **once and never overwritten** — an export skips them if they already
exist. Connector classes such as `LoginBackendConnector.kt` / `LoginBackendConnector.swift` are ordinary app
code and also survive. Keep wired node ids **stable** so the typed accessors and authored interactions still
resolve. If you renamed a wired id in step 3, update both connector classes and thin backend delegators (see
nativeui-connect) — a stale wired id fails LOUDLY at runtime by design (`IllegalStateException` / `fatalError`
naming the id), never silently.

> Clean/prod export is the `nui-export` default (`--prod` is accepted but redundant), or just
> `node <bin>/nui-run.mjs project.json --platform both` to rebuild + relaunch the updated prod app on the local
> emulator/simulator (skill: nativeui-run).

## 8. Final review
Run the reviewer before handoff:
```bash
node <bin>/nui-final-review.mjs \
	  --project project.json \
	  --html <stageId>.html \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --android-dir ./android-out \
  --ios-dir ./ios-out \
  --human
```
Include `--intake nativeui-intake.json` if the update used new source material and
`--architecture nativeui-architecture.md` when backend functionality exists. Pass the latest user requirements as
inline text or a path/`@path` file. Fix non-zero errors before claiming the update is complete.

## 9. Hand off
Confirm which screen changed, that the **other screens and the backend are intact** (only the one stage's
`rootNodes` changed; `NuiBackend.*` and `*BackendConnector.*` untouched unless the change required backend
wiring), and where the refreshed projects are (`./android-out`, `./ios-out`).
