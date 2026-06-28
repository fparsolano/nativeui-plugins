#!/usr/bin/env node
// nui-design-guide.mjs - scaffold/check a NativeUI design guide.
//
// Usage:
//   node bin/nui-design-guide.mjs init -o nativeui-design-guide.md [--prompt "..."] [--source nativeui-intake.json] [--force]
//   node bin/nui-design-guide.mjs check nativeui-design-guide.md

import { promises as fs } from 'node:fs';
import path from 'node:path';

class DesignGuideError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DesignGuideError';
  }
}

const USAGE = 'Usage: node bin/nui-design-guide.mjs init -o nativeui-design-guide.md [--prompt "..."] [--source nativeui-intake.json] [--force] | check nativeui-design-guide.md';
const REQUIRED_HEADINGS = [
  'Source Summary',
  'Responsive Requirements',
  'Portrait Layout',
  'Landscape Layout',
  'Visual System',
  'Motion And Interaction',
  'UX States',
  'Accessibility',
  'NativeUI Implementation Notes',
  'Open Questions',
];

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
    const breakpoints = Array.isArray(bundle.breakpoints) ? bundle.breakpoints.join(', ') : '';
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
  const content = `# NativeUI Design Guide

## Source Summary
Prompt:
${prompt}

${sourceSummary}

## Responsive Requirements
- Mobile portrait is the primary layout.
- Tablet/large-screen divisions must be explicit before import.
- Landscape behavior must be intentional, not merely stretched.

## Portrait Layout
- Define the screen hierarchy, primary action placement, scrolling regions, empty states, and safe-area behavior.

## Landscape Layout
- Define what reflows, what stays fixed, and whether primary content becomes split-pane, grid, or centered.

## Visual System
- Define typography scale, color roles, spacing rhythm, component states, imagery, and icon style.

## Motion And Interaction
- Define animation timing, entrance/exit motion, press feedback, loading transitions, and reduced-motion fallback.

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
  process.stdout.write(`ok: design guide has ${REQUIRED_HEADINGS.length} required sections\n`);
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
