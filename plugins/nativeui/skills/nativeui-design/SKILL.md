---
name: nativeui-design
description: >-
  NativeUI design agent for turning prompts, PDFs, screenshots/images, Figma, source-code references, URLs, or
  plain, interaction-free, or non-responsive HTML into an intentional responsive design direction before authoring/import. Use when the user
  is not using HTML as the source, when input HTML is unstyled, inert, or non-responsive, when layout, visual system,
  animation, responsive parent constraints, dynamic reflow, dynamic journey design, portrait/landscape behavior,
  UX states, or a styling guide is needed, or before
  nativeui-app/nativeui-update re-authors screens from loose design input.
metadata:
  argument_hint: "[prompt, reference, source, or inert HTML]"
allowed-tools: "Read Write Edit Glob Grep Bash(node <bin>/*) Bash(node <bin>/*)"
---
> Codex plugin path note: resolve `<bin>` as the NativeUI plugin's `bin/` directory and `<this-skill>` as `skills/nativeui-design` inside the installed plugin source before running commands.



# NativeUI design agent

Use this skill before NativeUI HTML/CSS authoring when the design direction is not already production-ready.
Its job is to turn loose input into a practical styling guide, responsive layout plan, and upgraded screen
direction that the `nativeui`, `nativeui-app`, or `nativeui-update` workflows can implement.

Responsiveness and dynamic flow are required design inputs, not optional polish. Every direction must define
phone-to-large-screen reflow and a usable journey with interactions, navigation, and relevant loading, empty,
validation/error, disabled, selected, retry, and success states. Do not produce an interaction-free mockup with dead controls.
Keep the page root fluid; size major regions from their parent with flex/grid growth, percentages, min/max
constraints, or paired anchors. Never disguise a fixed-width canvas with media queries around it.

## Trigger Rules

Invoke this design pass automatically when:
- the source is a prompt, PDF, screenshot/image, Figma link/JSON, source-code reference, URL, or other non-HTML
  material;
- HTML exists but looks like a plain wireframe, fixed mockup, default browser styling, or one-size inert layout;
- `nui-responsive-audit.mjs` fails, reports too few flexible layout signals, or identifies a missing
  content-required reflow path;
- the request mentions redesign, polish, UX, animations, responsiveness, portrait, landscape, tablet, density,
  theme, style guide, brand, or visual system.

Skip this pass only when the user explicitly wants to import existing HTML exactly as-is and that HTML already
has a responsive path.

## Design Brief

Ask a short brief before major design expansion when the answer is not already in the prompt or references.
Keep it focused:
- delivery surface and target family/lane; for web, static or SSR and its hosting runtime;
- target-derived support bounds and validation snapshots, desktop OSes, browsers, orientation, and input methods;
- primary journey, branches, completion/retry paths, and required UX states;
- for each major region: owning parent, fill/grow/shrink, min/max, scroll owner, and pinned anchors;
- visual tone: utilitarian, premium, playful, editorial, clinical, enterprise, etc.;
- content density: compact, comfortable, spacious, or dashboard-dense;
- motion level: none, subtle transitions, expressive animation, or data/status motion;
- must-preserve elements: copy, ids, brand colors, layout landmarks, forms, nav, or backend-wired controls.

If the user is unavailable or asked you to continue, make conservative assumptions, write them into the styling
guide, and keep the design easy to revise.

Use `../nativeui/references/delivery-targets.md` for contextual defaults and concise option descriptions. The
selected product and targets determine the test matrix and interaction modes, never a fixed authoring size.

## Styling Guide Output

Create or update `nativeui-design-guide.md` before authoring/re-authoring HTML. Start from the deterministic
guide scaffold when the file does not already exist:
```bash
node <bin>/nui-design-guide.mjs init -o nativeui-design-guide.md --prompt "<user prompt>"
```

Include:
- source summary and fidelity notes from `nativeui-intake.json`, screenshots, Figma, source code, or prompt;
- target screens and primary jobs-to-be-done;
- primary journey map: entry, actions, navigation branches, completion, retry/back paths, and ownership of state;
- responsive matrix with product- and target-derived compact, medium, and expanded snapshots; record exact test
  widths and input/orientation modes, but define a breakpoint only where content or interaction requires a
  structural change;
- parent-constraint matrix: which parent owns each major region's width/height, its fill/grow/shrink behavior,
  min/max caps, scroll ownership, and paired anchors for pinned chrome;
- portrait/landscape intent, translated into width-based layout variants rather than unsupported assumptions;
- design tokens: color roles, typography scale, spacing scale, radii, borders, elevation/shadow, icon style;
- component patterns: nav, app bars, cards, forms, lists/repeaters, charts, empty/error/loading states;
- animation system: what moves, why it moves, duration/easing, and which `@keyframes` belong in the HTML;
- accessibility and UX notes: contrast, touch target size, label clarity, focus/disabled/error states;
- NativeUI implementation notes: supported HTML/CSS choices, assets to inline/import, and ids to preserve.

The guide is a source artifact for the rest of the workflow, not marketing copy. Keep it concrete enough that
another agent can author the screens from it.

## Re-Authoring Rules

When updating user designs or plain/inert HTML:
- preserve semantic content, screen names, form fields, navigation intent, and letter-first ids unless the user
  asks to change them;
- preserve backend-wired ids and interaction targets when working from an existing project;
- keep `body` and the page root at `width:100%` and `min-width:0`; use flex/grid, `minmax(0,1fr)`, `flex:1`,
  percentages, min/max caps, and paired anchors so every major region resolves from its parent;
- test the selected compact/medium/expanded snapshots and add a structural width breakpoint only where labels,
  controls, reading measure, navigation, density, or region placement requires reflow rather than mere scaling;
- add UX states that a native app needs: empty, loading, validation, disabled, selected, success/error, and
  skeleton/placeholder states when relevant;
- add purposeful animation with `@keyframes` and `animation`; do not use JavaScript or runtime-only CSS tricks;
- stay inside `../nativeui/references/authoring-rules.md`: no `<script>`, no external/CDN CSS, no remote images,
  no reliance on stripped `data-*` attributes, and no unsupported CSS as the core visual mechanism;
- keep the result intrinsically responsive without a fixed pixel body width or device-first baseline. Treat
  portrait/landscape and input mode as product intent, and implement content-derived width reflow only where
  needed unless the NativeUI authoring rules explicitly support a more specific media condition.

## Handoff Checks

Before handing back to `nativeui-app`, `nativeui`, or `nativeui-update`:
```bash
node <bin>/nui-design-guide.mjs check nativeui-design-guide.md
node <bin>/nui-responsive-audit.mjs <screen.html...>
node <bin>/nui-flow-audit.mjs <screen.html...>
```

Fix every failure. The final handoff should identify:
- the `nativeui-design-guide.md` path;
- the HTML files or project screen to author/update next;
- any unresolved questions or assumptions that affect fidelity;
- whether ids/interactions were preserved for later `nativeui-developer` or `nativeui-connect` work.
