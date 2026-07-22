---
name: nativeui-update
description: >-
  Make a round-trip-safe change to ONE screen of an existing NativeUI app and re-export. Use when the user
  asks to edit/update/change/tweak/redesign a single screen — change its layout, colors, text, add a
  component, fix spacing, preserve dynamic flow, or adjust an animation or responsive breakpoint — without disturbing other screens
  or the backend. Handles updated PDF/image/Figma/source inputs, audits responsiveness, re-authors that
  screen's HTML/CSS, merges only that stage back into project.json, and re-exports selected targets while
  preserving stage identity, other screens, shared resources, and durable logic seams.
metadata:
  argument_hint: "[project.json] [screen] [change]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Read Write Edit Glob Grep"
---

# Update one NativeUI screen (round-trip-safe)

Change a single screen and re-export without breaking the rest of the app or the backend. The sanctioned path
is **re-author the screen's HTML/CSS → re-import → re-export** — never hand-edit `project.json` to make a
structural change. `<bin>` = `${CLAUDE_SKILL_DIR}/../../bin`.

The changed screen must remain responsive and part of a real dynamic flow. Preserve existing navigation and
interactions, keep actionable controls wired, and update relevant loading/empty/error/success states whenever
the changed UI affects a form, list, or data operation.

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

If the update is a redesign/polish request, uses non-HTML source material, or the existing HTML is plain, interaction-free,
or non-responsive, invoke `nativeui-design` before re-authoring. It should update `nativeui-design-guide.md`,
ask any needed responsiveness/portrait/landscape/UX questions, and produce the styling guide, animation, and
responsive layout direction for this one screen while preserving backend-wired ids.

## 4. Re-author that screen's HTML/CSS
Produce the updated standalone HTML document for ONLY that screen, per
`${CLAUDE_SKILL_DIR}/../nativeui/references/authoring-rules.md`: plain HTML/CSS only (no `<script>`, no external
stylesheets); arbitrary `data-*` attributes are stripped, while documented reserved portable `data-nui-*`
attributes are allowed; content-first intrinsic layout with fluid parent constraints and explicit scroll
ownership; product/target-derived compact/medium/expanded validation; content-required `@media` reflow;
`@keyframes` for animation;
stable letter-first ids; `<title>` = screen name. Save it as `<stageId>.html`. Preserve the ids and `<title>`
of nodes wired through any manifest-declared durable seam unless the user explicitly wants them renamed. If
`nativeui-design-guide.md` exists, follow its styling guide and responsive UX direction for the changed screen.

## 5. Audit responsiveness
Before re-importing, audit the updated screen HTML:
```bash
node <bin>/nui-responsive-audit.mjs <stageId>.html
node <bin>/nui-flow-audit.mjs <stageId>.html
```
Fix every failure. The deprecated `--allow-static` audit opt-out cannot bypass responsive or dynamic-flow
requirements and is unrelated to static web build/hosting mode. Audit the project again after import too.

When an audit fails, report it as a project-readiness blocker rather than a missing capability of the selected
lane. Name the missing state, confirm the lane supports it, correct the source, and re-audit before export.

## 6. Merge only the changed screen
Extract the current stage when its source HTML is unavailable, then update only that stage:
```bash
node <bin>/nui-screen-extract.mjs project.json --stage <stageId> -o <stageId>.html
# edit and audit <stageId>.html
node <bin>/nui-screen-update.mjs project.json --stage <stageId> --html <stageId>.html
```
The updater preserves stage ID, existing name unless `--rename` is explicit, board placement, navigation,
non-target stages, metadata, and unrelated shared resources. Library collisions get stable remapped IDs.
Validation happens in temporary storage before atomic replacement. A failed import/merge writes nothing.

> A direct `project.json` edit is acceptable ONLY for a trivial scalar change (one label's text, one color):
> find the node by `id`, change the scalar field, keep the `#rrggbb@alpha` color format. Anything structural
> goes through re-author + re-import.

## 7. Re-export selected targets — durable seams survive
Export **into the existing project directories** so the write-once backend files are preserved in place:
```bash
node <bin>/nui-export.mjs project.json --target auto -o ./native-out
```
**Why this is round-trip-safe:** the exporter regenerates UI and generated contracts, while merge-aware
extraction preserves every manifest-declared seam: Swift/Kotlin action files, legacy backend delegators and
connectors, `app_actions.rs`, `AppActions.cs`, and the manifest-declared web `app-actions`, `data-adapters`, and
`custom-components` seams. Keep wired node and stage IDs stable. If an
ID changes intentionally, update every selected seam and its target tests.

> Clean/prod export is the `nui-export` default (`--prod` is accepted but redundant), or just
> `node <bin>/nui-run.mjs project.json --target auto` to rebuild + relaunch the updated prod app on the local
> emulator/simulator (skill: nativeui-run).

## 8. Final review
Run the reviewer before handoff:
```bash
node <bin>/nui-final-review.mjs \
	  --project project.json \
	  --html <stageId>.html \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --target ios-swiftui --target-dir ios-swiftui=./native-out/ios-swiftui \
  --target android-compose --target-dir android-compose=./native-out/android-compose \
  --human
```
Include `--intake nativeui-intake.json` if the update used new source material and
`--architecture nativeui-architecture.md` when backend functionality exists. Pass the latest user requirements as
inline text or a path/`@path` file. Fix non-zero errors before claiming the update is complete.

## 9. Hand off
Confirm which screen changed, that non-target screens, metadata, navigation, shared resources, and durable seams
are intact, and list every refreshed target directory and gate status.
