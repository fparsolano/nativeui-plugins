#!/usr/bin/env node
// nui-design-guide.mjs - scaffold/check a NativeUI design guide.
//
// Usage:
//   node bin/nui-design-guide.mjs init -o nativeui-design-guide.md [--prompt "..."] [--source nativeui-intake.json] [--force]
//   node bin/nui-design-guide.mjs check nativeui-design-guide.md

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateDesignGuideDecisions } from './delivery-decision-validation.mjs';

class DesignGuideError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DesignGuideError';
  }
}

const USAGE = 'Usage: node bin/nui-design-guide.mjs init -o nativeui-design-guide.md [--prompt "..."] [--source nativeui-intake.json] [--force] | check nativeui-design-guide.md';
const REQUIRED_HEADINGS = [
  'Source Summary',
  'Delivery Targets',
  'Primary Journey',
  'Responsive Requirements',
  'Responsive Matrix',
  'Parent Constraint Matrix',
  'Portrait Layout',
  'Landscape Layout',
  'Visual System',
  'Motion And Interaction',
  'Dynamic State Flow',
  'UX States',
  'Accessibility',
  'NativeUI Implementation Notes',
  'Open Questions',
];

function inferSurfaces(prompt) {
  const value = String(prompt || '').toLowerCase();
  const surfaces = [];
  const desktopIntent = /\b(?:desktop|workstation|windows|macos|linux)\b/.test(value);
  const explicitMobileIntent = /\b(?:mobile|phone|tablet|ios|ipados|android)\b/.test(value);
  // SwiftUI and Compose normally imply mobile, except when the prompt explicitly scopes a desktop product.
  // In particular, "macOS SwiftUI" must reach the honest desktop-choice guidance instead of also inventing
  // an unrelated flagship-mobile deliverable.
  if (explicitMobileIntent || !desktopIntent && /\b(?:swiftui|compose)\b/.test(value)) surfaces.push('mobile');
  if (/\b(?:web|website|browser|pwa|html|react|vue|angular|astro)\b/.test(value)) surfaces.push('web');
  if (desktopIntent) surfaces.push('desktop');
  return surfaces.length ? surfaces : ['unspecified'];
}

function deliveryDefaults(surfaces) {
  const lines = [`- Inferred surface intent: ${surfaces.join(', ')}`];
  if (surfaces.includes('mobile')) {
    lines.push('- Mobile default: flagship native pair (`ios-swiftui` and `android-compose`) for idiomatic platform UI and the strongest release gates. Name beta Rust mobile for a shared Rust runtime/action seam and beta C# mobile for .NET teams; ask about one OS only when the prompt makes that scope ambiguous.');
  }
  if (surfaces.includes('web')) {
    lines.push('- Web default: dependency-free `web-html` with static build/hosting. Offer React Router for React teams, Nuxt/Vue for convention-led universal apps, Angular for structured enterprise work, and Astro for HTML-first selective hydration; framework lanes support static or SSR. Static is a delivery mode, never a reduction in responsive layout, dynamic flow, or manifest capabilities.');
  }
  if (surfaces.includes('desktop')) {
    lines.push('- Desktop choices: default to beta `rust-desktop` for a small cross-platform native runtime; offer beta `csharp-desktop` for cross-platform .NET ownership; and always describe macOS SwiftUI as the Apple-native desktop alternative that requires a separately scoped/new `macos-swiftui` exporter. No macOS SwiftUI exporter is currently registered, and `ios-swiftui` must not be presented as desktop output.');
  }
  if (surfaces.includes('unspecified')) {
    lines.push('- Surface is unresolved: confirm mobile, web, desktop, or a deliberate combination before implementation.');
  }
  return lines.join('\n');
}

function responsiveDefaults(surfaces) {
  const rows = [];
  if (surfaces.includes('mobile')) {
    rows.push('| Mobile | Compact phone portrait through tablet/landscape | Derive stack, split, or grid topology from the task, content, and available parent space | Adapt navigation to the journey, safe areas, and available space | Comfortable touch targets | Page or named content region |');
  }
  if (surfaces.includes('web')) {
    rows.push('| Web | Narrow phone browser through large desktop | Derive stack, split, or grid topology from the task, content, reading measure, and available parent space | Adapt navigation without hiding the primary task | Pointer, keyboard, and touch | Page or named content region |');
  }
  if (surfaces.includes('desktop')) {
    rows.push('| Desktop | Minimum supported window through maximized/ultrawide | Preserve useful resizability; add panes only when space and task structure justify them | Persistent menu/sidebar/toolbar as selected | Keyboard and pointer dense | Named pane or content region |');
  }
  if (surfaces.includes('unspecified')) {
    rows.push('| Unresolved surface | Narrow phone through large resizable window | Start fluid and document each intentional reflow | Adapt navigation to available space and input | Touch, keyboard, and pointer | Page or named content region |');
  }
  return rows.join('\n');
}

function parseArgs(argv) {
  const command = argv[0] || '';
  if (!['init', 'check'].includes(command)) throw new DesignGuideError(USAGE);
  let out = '';
  let prompt = '';
  let source = '';
  let force = false;
  let file = '';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      out = argv[++i] || '';
    } else if (a === '--prompt') {
      prompt = argv[++i] || '';
    } else if (a === '--source') {
      source = argv[++i] || '';
    } else if (a === '--force') {
      force = true;
    } else if (a === '-h' || a === '--help') {
      throw new DesignGuideError(USAGE);
    } else if (a.startsWith('-')) {
      throw new DesignGuideError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!file) {
      file = a;
    } else {
      throw new DesignGuideError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (command === 'init' && !out) throw new DesignGuideError(`Missing -o/--out.\n${USAGE}`);
  if (command === 'check' && !file) throw new DesignGuideError(`Missing design guide path.\n${USAGE}`);
  return { command, out, prompt, source, force, file };
}

async function loadSourceSummary(source) {
  if (!source) return 'No intake bundle supplied. Summarize the prompt, references, and constraints before authoring.';
  const sourcePath = path.resolve(source);
  try {
    const bundle = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
    const inputs = Array.isArray(bundle.inputs) ? bundle.inputs.length : 0;
    const gaps = Array.isArray(bundle.gaps) ? bundle.gaps.length : 0;
    const breakpoints = Array.isArray(bundle.responsive?.breakpoints)
      ? bundle.responsive.breakpoints.join(', ')
      : Array.isArray(bundle.breakpoints) ? bundle.breakpoints.join(', ') : '';
    return [
      `Intake bundle: ${sourcePath}`,
      `Inputs: ${inputs}`,
      `Gaps: ${gaps}`,
      breakpoints ? `Detected breakpoints: ${breakpoints}` : 'Detected breakpoints: not supplied',
    ].join('\n');
  } catch {
    return `Source reference: ${sourcePath}\nCould not parse it as an intake bundle; inspect it manually before authoring.`;
  }
}

async function initGuide(opts) {
  const outPath = path.resolve(opts.out);
  if (!opts.force) {
    try {
      await fs.stat(outPath);
      throw new DesignGuideError(`${outPath} already exists. Re-run with --force to overwrite.`);
    } catch (e) {
      if (e instanceof DesignGuideError) throw e;
    }
  }
  const sourceSummary = await loadSourceSummary(opts.source);
  const prompt = opts.prompt.trim() || 'Not supplied.';
  const surfaces = inferSurfaces(prompt);
  const content = `# NativeUI Design Guide

## Source Summary
Prompt:
${prompt}

${sourceSummary}

## Delivery Targets
${deliveryDefaults(surfaces)}
- Selected target IDs:
- Web lane and render mode (if applicable):
- Supported devices, operating systems, CPU architectures, and browser baseline:
- Assumptions requiring user confirmation:

## Primary Journey
- Primary actor and job to be done:
- Entry route/stage and preconditions:
- Ordered happy-path steps:
- Alternate, cancellation, and recovery paths:
- Completion state and next action:
- Back, deep-link, refresh/relaunch, and resume behavior:

## Responsive Requirements
- Responsive behavior is the default; do not treat the reference viewport as a fixed canvas.
- Each surface must cover its minimum, content-relevant intermediate, and maximum supported viewport or window.
- Reflow, navigation changes, safe areas, input modality, and text scaling must be intentional.
- Parent containers own available width and height; children express fill/grow/shrink and min/max bounds.
- Each axis has an explicit scroll owner, and anchors remain paired to the owning parent through resize and reflow.

## Responsive Matrix
| Surface | Viewport/window classes | Layout and reflow | Navigation and safe areas | Input/density | Scroll owner |
| --- | --- | --- | --- | --- | --- |
${responsiveDefaults(surfaces)}

## Parent Constraint Matrix
| Region/component | Owning parent | Width ownership | Height ownership | Fill/grow/shrink | Min/max bounds | Scroll owner | Anchors/alignment | Reflow rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| App shell | Viewport/window | Parent supplies available width | Parent supplies available height | Fill; shrink without overflow | Record supported minimum and readable maximum | Name the single page/pane owner | Pin paired edges or center deliberately | Record breakpoint/window transition |
| Primary content | App shell | Fill available width or use a parent-owned max width | Grow from content; fill only when the parent grants height | Record flex/grid growth and shrink priority | Record content and control bounds | Do not create nested same-axis scrolling accidentally | Anchor to shell/content grid | Record stack/split/grid behavior |
- Add a row for every major region, overlay, repeated collection, and independently scrolling pane.
- A child must not hardcode the size of its parent; document which parent grants space and which child may grow or shrink.

## Portrait Layout
- Define the screen hierarchy, primary action placement, scrolling regions, empty states, and safe-area behavior.

## Landscape Layout
- Define what reflows, what remains intrinsically sized or pinned to its owning parent, and whether primary content becomes split-pane, grid, or deliberately centered.

## Visual System
- Define typography scale, color roles, spacing rhythm, component states, imagery, and icon style.

## Motion And Interaction
- Define animation timing, entrance/exit motion, press feedback, loading transitions, and reduced-motion fallback.

## Dynamic State Flow
| Trigger/event | Current state/route | Action and constraints | Pending state | Success/next state | Empty/error/offline state | Focus, announcement, and back behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Primary action | Initial | Validate, mutate local state, navigate, or call a developer-owned seam | Disable duplicate submission and show progress when asynchronous | Name the resulting state or route | Define recovery without losing user input | Move focus or announce the result; preserve predictable back behavior |
- Add every tap/click, submit, selection, navigation, timeline, data refresh, and external-effect transition.
- Show how state changes affect layout, visibility, parent constraints, scroll position, and responsive variants.

## UX States
- Cover loading, empty, error, disabled, success, offline, and authenticated/unauthenticated states.

## Accessibility
- Cover contrast, tap target size, focus/reading order, labels for meaningful images, and text scaling risk.

## NativeUI Implementation Notes
- Prefer supported HTML/CSS import surface.
- Inline device-rendered images as data URIs.
- Use letter-first ids for native typed accessors.
- Register API/database data sources before wiring live native behavior.

## Open Questions
- List any decisions the user still needs to answer before authoring.
`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, content);
  process.stdout.write(`Wrote design guide -> ${outPath}\n`);
}

async function checkGuide(file) {
  const full = path.resolve(file);
  const text = await fs.readFile(full, 'utf8').catch((e) => {
    throw new DesignGuideError(e.code === 'ENOENT' ? `Design guide not found: ${file}` : `Could not read ${file}: ${e.message}`);
  });
  const missing = REQUIRED_HEADINGS.filter((heading) => !new RegExp(`^##\\s+${heading}\\s*$`, 'mi').test(text));
  if (missing.length) {
    throw new DesignGuideError(`Design guide is missing required section(s): ${missing.join(', ')}`);
  }
  const decisions = validateDesignGuideDecisions(text);
  if (decisions.errors.length) {
    throw new DesignGuideError(`Design guide has unresolved required decision(s):\n- ${decisions.errors.join('\n- ')}`);
  }
  process.stdout.write(`ok: design guide has ${REQUIRED_HEADINGS.length} required sections and resolved delivery/constraint decisions\n`);
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.command === 'init') await initGuide(opts);
    else await checkGuide(opts.file);
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}

main();
