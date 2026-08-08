// intake.test.mjs - nui-intake.mjs normalizes HTML, source folders, Figma URLs,
// and fail-closed missing inputs without auth/network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nui-intake-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('extracts HTML media queries and assets into an intake bundle', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'home.html');
  const out = path.join(dir, 'nativeui-intake.json');
  fs.writeFileSync(html, `<!doctype html>
<html><head><title>Home</title><style>
.screen { display:flex; width:100%; }
.card { width:100%; max-width:40rem; }
@media (min-width: 736px) { .screen { display:grid; grid-template-columns: repeat(2, 1fr); } }
</style></head>
<body><main id="home_screen"><img id="hero_img" src="data:image/png;base64,abc" /></main></body></html>`);

  const { env } = unconfiguredEnv();
  const r = runBin('nui-intake.mjs', [html, '-o', out], { env });
  assert.equal(r.status, 0, r.stderr);
  const bundle = readJson(out);
  assert.equal(bundle.sources[0].kind, 'html');
  assert.deepEqual(bundle.responsive.breakpoints, [736]);
  assert.deepEqual(bundle.responsiveTargets, [736]);
  assert.equal(bundle.sources[0].html.title, 'Home');
  assert.ok(bundle.assets.find((a) => a.type === 'image-reference' && a.embedded === true));
});

test('derives responsive validation snapshots from selected targets and content when intake has no sizing evidence', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'prompt-only.json');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-intake.mjs', [
    '--prompt',
    'Build a responsive web dashboard with keyboard and touch interactions.',
    '-o',
    out,
  ], { env });
  assert.equal(r.status, 0, r.stderr);
  const bundle = readJson(out);
  assert.deepEqual(bundle.responsiveTargets, []);
  assert.equal(bundle.responsiveTargetPolicy, 'derive-validation-snapshots-from-selected-targets-and-content');
  assert.equal(bundle.gaps.some((gap) => gap.code === 'responsive.targets.unresolved'), false);
  assert.ok(bundle.nextSteps.some((step) => /selected delivery targets and content constraints/i.test(step)));
  assert.ok(bundle.nextSteps.some((step) => /never a preferred authoring canvas/i.test(step)));
});

test('derives viewport targets only from explicit preview dimensions', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'explicit-targets.json');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-intake.mjs', [
    '--prompt',
    'Build a responsive web app from 390\u00d7844 to 1440\u00d7900.',
    '-o',
    out,
  ], { env });
  assert.equal(r.status, 0, r.stderr);
  const bundle = readJson(out);
  assert.deepEqual(bundle.responsiveTargets, [390, 1440]);
  assert.equal(bundle.responsiveTargetPolicy, 'explicit-source-or-prompt-snapshots');
  assert.equal(bundle.gaps.some((gap) => gap.code === 'responsive.targets.unresolved'), false);
});

test('summarizes source folders: components, routes, classes, responsive CSS', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), `
export function DashboardScreen() {
  return <Route path="/dashboard" element={<main className="screen stats-grid" />} />;
}
`);
  fs.writeFileSync(path.join(dir, 'src', 'style.css'), `
.stats-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 900px) { .stats-grid { grid-template-columns: repeat(3, 1fr); } }
`);
  const out = path.join(dir, 'bundle.json');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-intake.mjs', [path.join(dir, 'src'), '-o', out], { env });
  assert.equal(r.status, 0, r.stderr);
  const bundle = readJson(out);
  const src = bundle.sources.find((s) => s.kind === undefined && s.type === 'directory');
  assert.ok(src, `directory summary missing: ${JSON.stringify(bundle.sources)}`);
  assert.ok(src.sourceSummary.possibleComponents.includes('DashboardScreen'));
  assert.ok(src.sourceSummary.possibleRoutes.includes('/dashboard'));
  assert.ok(bundle.responsive.breakpoints.includes(900));
});

test('parses Figma URLs and records a token gap without fetching', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'figma.json');
  const { env } = unconfiguredEnv();
  delete env.FIGMA_TOKEN;
  delete env.NATIVEUI_FIGMA_TOKEN;
  const url = 'https://www.figma.com/design/AbCdEf123456/My-File?node-id=1-2';
  const r = runBin('nui-intake.mjs', [url, '-o', out], { env });
  assert.equal(r.status, 0, r.stderr);
  const bundle = readJson(out);
  assert.equal(bundle.sources[0].kind, 'figma-url');
  assert.equal(bundle.sources[0].fileKey, 'AbCdEf123456');
  assert.ok(bundle.gaps.find((g) => g.code === 'figma.token.missing'));
});

test('fail-closed: missing file exits non-zero and writes no bundle', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'missing.json');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-intake.mjs', [path.join(dir, 'nope.html'), '-o', out], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Input not found/);
  assert.equal(fs.existsSync(out), false);
});
