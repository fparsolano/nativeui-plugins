---
name: nativeui-review
description: >-
  Final NativeUI design review before handoff/export: verify screens are valid, responsive, and faithful to
  user instructions; catch unsupported HTML/CSS, unresolved intake gaps, event/runtime mistakes, and backend
  logic placed in NuiBackend instead of connector classes.
metadata:
  argument_hint: "[project.json] [html files or exported dirs]"
allowed-tools: "Bash(node <bin>/*) Read Glob Grep"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-review` inside the installed plugin source before running commands.



# Final NativeUI Review

Use this as the last pass before claiming a design is done, especially after an agent generated screens from
PDFs, screenshots/images, Figma, source code, or existing HTML/CSS. This review is intentionally strict: it
protects the product flow from unsupported import surface, non-responsive screens, broken events, and backend
code that would be clobbered by UI regeneration.

`<bin>` = `<bin>`.

## 1. Run the final review gate
For authored HTML + project:
```bash
node <bin>/nui-final-review.mjs \
	  --project project.json \
	  --html home.html details.html \
	  --intake nativeui-intake.json \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --human
```

When exported native dirs exist, include them so the review can check connector usage:
```bash
node <bin>/nui-final-review.mjs \
  --project project.json \
	  --html home.html details.html \
	  --intake nativeui-intake.json \
	  --architecture nativeui-architecture.md \
	  --instructions user-instructions.md \
	  --android-dir ./android-out \
  --ios-dir ./ios-out \
  --human
```
Pass `--instructions` as either inline text or a path/`@path` file containing the user's latest requirements.

Use `--allow-static` only when the user explicitly asked for a fixed/non-responsive screen.

## 2. What must pass
- HTML import surface: no `<script>`, external stylesheet links, remote images, or reliance on stripped `data-*`.
- Responsiveness: authored HTML and/or `project.json` has a real responsive path (`@media`, smart divisions,
  semantic responsive fields, `%`, `fr`, flex/grid, etc.) unless `--allow-static`.
- Project validity: non-empty stages/root nodes, stable letter-first ids, no duplicate ids.
- Repeaters: preview-backed repeater regions should include local `sampleItems` or reference a `dataAdapters[]`
  entry; any adapter-backed source should point at a registered `api`/`database` library item before live
  connector wiring. If the user asked for live/API/database-backed data, an unregistered repeater `dataSource`
  is a failing error, not a handoff warning.
- Events: actions with no automatic runtime path (`RUN_SCRIPT`, `SUBMIT_FORM`, `OPEN_URL`, `SET_STATE`) must be
	  implemented in connectors or removed. `CALL_API`, `CALL_DATABASE`, and `PLAY_TIMELINE` need connector hooks.
- Architecture approval: backend-required functionality must have an approved `nativeui-architecture.md` before
  final handoff; use `nativeui-architect` if the decision record is missing or unchecked.
- Backend boundary: `NuiBackend.kt` / `NuiBackend.swift` are thin delegators; durable app/backend behavior lives
  in `*BackendConnector.kt` and `*BackendConnector.swift`.
- Intake gaps: unresolved PDF/image/Figma/source gaps must be acknowledged and resolved before claiming visual
  fidelity.

## 3. Fix before handoff
If the gate returns non-zero, fix the errors and re-run:
- unsupported HTML/CSS → rewrite to the supported surface in `../nativeui/references/authoring-rules.md`;
- missing responsiveness → add breakpoints/flexible layout and rerun `nui-responsive-audit.mjs`;
- event/backend issues → run `nui-connectors-plan.mjs`, add connector classes, and keep `NuiBackend.*` thin;
- missing architecture approval → run `nativeui-architect`, get approval, then pass `--architecture`;
- unresolved intake gaps → inspect/provide the missing source, asset, Figma token/export, or screenshot.

Only hand off after `nui-final-review.mjs` passes or after the user explicitly accepts the remaining warnings.
