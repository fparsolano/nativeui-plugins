---
name: nativeui-intake
description: >-
  Normalize messy design inputs for NativeUI before authoring: PDFs, screenshots/images, Figma URLs or JSON,
  existing HTML/CSS, source-code repos/files, URLs, and product prompts. Use when the user provides source
  material to build screens from, or when responsiveness needs to be inferred and verified before import/export.
metadata:
  argument_hint: "[inputs...]"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Read Glob Grep"
---

# NativeUI intake and responsive audit

Use this before authoring NativeUI HTML/CSS whenever the user gives anything more concrete than a plain prompt:
PDFs, screenshots, exported images, Figma links/JSON, existing HTML/CSS, source code, or a website URL. The goal
is to turn messy inputs into a measured, provenance-rich bundle so the agent does not guess layout.

`<bin>` = `${CLAUDE_SKILL_DIR}/../../bin`.

## 1. Build the intake bundle
Run the dependency-free intake tool on every provided input:
```bash
node <bin>/nui-intake.mjs <input...> -o nativeui-intake.json
```

For a prompt-only run, still capture the prompt when it contains concrete product requirements:
```bash
node <bin>/nui-intake.mjs --prompt "build a responsive finance dashboard" -o nativeui-intake.json
```

What the bundle contains:
- source summaries for HTML/CSS, PDFs, images, Figma URLs/JSON, source folders, and URLs;
- extracted media queries/breakpoints, source routes/components/classes, assets, and Figma node metadata;
- provenance and confidence per source;
- explicit `gaps[]` for missing visual facts, unavailable Figma tokens, PDF/image semantics, unsupported files, or non-fetched URLs.

Hard rule: do not claim visual fidelity for a gap. Resolve it through local inspection, an exported asset, or a user answer.

## 2. Translate into NativeUI authoring intent
From `nativeui-intake.json`, derive:
- screens/pages and navigation;
- reusable components/chrome;
- responsive breakpoints and target widths;
- assets that must be inlined or imported;
- repeaters/data lists and backend events;
- unsupported CSS/features that need a NativeUI-supported replacement.

Use `../nativeui/references/authoring-rules.md` for the supported HTML/CSS surface.

If the source is not production-ready HTML, or the HTML is plain/static/non-responsive, hand the bundle to
`nativeui-design` next. That design agent creates `nativeui-design-guide.md`, asks concise
responsiveness/portrait/landscape/UX questions when needed, and turns the intake facts into a styling guide,
animation plan, and responsive layout direction before HTML authoring.

## 3. Author HTML/CSS, then audit responsiveness
Before import/export, audit the authored HTML/CSS:
```bash
node <bin>/nui-responsive-audit.mjs home.html details.html
```

The audit must pass for generated app flows. Use `--allow-static` only when the user explicitly wants a fixed,
non-responsive design. Fix failures by adding real responsive structure: `@media` width breakpoints, `%`, `fr`,
`flex-grow`, viewport units, `calc()`/`clamp()`, or smart layout structure.

For an existing project:
```bash
node <bin>/nui-responsive-audit.mjs project.json
```

## 4. Continue the normal NativeUI flow
Once intake gaps are handled and responsiveness passes:
```bash
node <bin>/nui-import.mjs home.html details.html -o project.json
node <bin>/nui-validate.mjs project.json
node <bin>/nui-export.mjs project.json --platform android -o ./android-out
node <bin>/nui-export.mjs project.json --platform ios     -o ./ios-out
```

For backend work, run:
```bash
node <bin>/nui-connectors-plan.mjs project.json --human
```
Then keep `NuiBackend.*` as thin delegators and put app/backend logic in the planned `*BackendConnector.*`
classes on both platforms.
