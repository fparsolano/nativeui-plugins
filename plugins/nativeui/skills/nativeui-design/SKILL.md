---
name: nativeui-design
description: >-
  NativeUI design agent for turning prompts, PDFs, screenshots/images, Figma, source-code references, URLs, or
  plain/static HTML into an intentional mobile-first design direction before authoring/import. Use when the user
  is not using HTML as the source, when input HTML is unstyled/static/non-responsive, when layout, visual system,
  animation, responsiveness, portrait/landscape behavior, UX states, or a styling guide is needed, or before
  nativeui-app/nativeui-update re-authors screens from loose design input.
metadata:
  argument_hint: "[prompt, reference, source, or static HTML]"
allowed-tools: "Read Write Edit Glob Grep Bash(node <bin>/*) Bash(node <bin>/*)"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-design` inside the installed plugin source before running commands.



# NativeUI design agent

Use this skill before NativeUI HTML/CSS authoring when the design direction is not already production-ready.
Its job is to turn loose input into a practical styling guide, responsive layout plan, and upgraded screen
direction that the `nativeui`, `nativeui-app`, or `nativeui-update` workflows can implement.

## Trigger Rules

Invoke this design pass automatically when:
- the source is a prompt, PDF, screenshot/image, Figma link/JSON, source-code reference, URL, or other non-HTML
  material;
- HTML exists but looks like a plain wireframe, fixed mockup, default browser styling, or static one-size layout;
- `nui-responsive-audit.mjs` fails or reports no `@media` width breakpoints and few flexible layout signals;
- the request mentions redesign, polish, UX, animations, responsiveness, portrait, landscape, tablet, density,
  theme, style guide, brand, or visual system.

Skip this pass only when the user explicitly wants to import existing HTML exactly as-is and that HTML already
has a responsive path.

## Design Brief

Ask a short brief before major design expansion when the answer is not already in the prompt or references.
Keep it focused:
- target device modes: phone portrait, phone landscape, tablet, or all;
- visual tone: utilitarian, premium, playful, editorial, clinical, enterprise, etc.;
- content density: compact, comfortable, spacious, or dashboard-dense;
- motion level: none, subtle transitions, expressive animation, or data/status motion;
- must-preserve elements: copy, ids, brand colors, layout landmarks, forms, nav, or backend-wired controls.

If the user is unavailable or asked you to continue, make conservative assumptions, write them into the styling
guide, and keep the design easy to revise.

## Styling Guide Output

Create or update `nativeui-design-guide.md` before authoring/re-authoring HTML. Start from the deterministic
guide scaffold when the file does not already exist:
```bash
node <bin>/nui-design-guide.mjs init -o nativeui-design-guide.md --prompt "<user prompt>"
```

Include:
- source summary and fidelity notes from `nativeui-intake.json`, screenshots, Figma, source code, or prompt;
- target screens and primary jobs-to-be-done;
- responsive matrix using NativeUI-supported width breakpoints, normally phone base `390-430`, wide/landscape
  phone `600+`, tablet `768+`, and large/editor preview `1024+` when useful;
- portrait/landscape intent, translated into width-based layout variants rather than unsupported assumptions;
- design tokens: color roles, typography scale, spacing scale, radii, borders, elevation/shadow, icon style;
- component patterns: nav, app bars, cards, forms, lists/repeaters, charts, empty/error/loading states;
- animation system: what moves, why it moves, duration/easing, and which `@keyframes` belong in the HTML;
- accessibility and UX notes: contrast, touch target size, label clarity, focus/disabled/error states;
- NativeUI implementation notes: supported HTML/CSS choices, assets to inline/import, and ids to preserve.

The guide is a source artifact for the rest of the workflow, not marketing copy. Keep it concrete enough that
another agent can author the screens from it.

## Re-Authoring Rules

When updating user designs or plain/static HTML:
- preserve semantic content, screen names, form fields, navigation intent, and letter-first ids unless the user
  asks to change them;
- preserve backend-wired ids and interaction targets when working from an existing project;
- upgrade layout with real structure: flex/grid, spacing rhythm, responsive width breakpoints, scroll regions,
  and stable component proportions;
- add UX states that a native app needs: empty, loading, validation, disabled, selected, success/error, and
  skeleton/placeholder states when relevant;
- add purposeful animation with `@keyframes` and `animation`; do not use JavaScript or runtime-only CSS tricks;
- stay inside `../nativeui/references/authoring-rules.md`: no `<script>`, no external/CDN CSS, no remote images,
  no reliance on stripped `data-*` attributes, and no unsupported CSS as the core visual mechanism;
- keep the result mobile-first at 412px, then add `@media` width breakpoints for larger/landscape/tablet
  behavior. Treat portrait/landscape as product intent, but implement it with supported width-based responsive
  paths unless the NativeUI authoring rules explicitly support a more specific media condition.

## Handoff Checks

Before handing back to `nativeui-app`, `nativeui`, or `nativeui-update`:
```bash
node <bin>/nui-design-guide.mjs check nativeui-design-guide.md
node <bin>/nui-responsive-audit.mjs <screen.html...>
```

Fix failures unless the user explicitly asked for a fixed/static artifact. The final handoff should identify:
- the `nativeui-design-guide.md` path;
- the HTML files or project screen to author/update next;
- any unresolved questions or assumptions that affect fidelity;
- whether ids/interactions were preserved for later `nativeui-developer` or `nativeui-connect` work.
