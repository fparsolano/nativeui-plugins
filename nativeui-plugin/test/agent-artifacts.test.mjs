// agent-artifacts.test.mjs - deterministic design/architecture artifacts for agents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nui-agent-artifacts-'));
}

test('nui-design-guide scaffolds and checks the design guide contract', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'nativeui-design-guide.md');
  const { env } = unconfiguredEnv();
  const init = runBin('nui-design-guide.mjs', ['init', '-o', out, '--prompt', 'Trips app'], { env });
  assert.equal(init.status, 0, init.stderr);
  assert.ok(fs.existsSync(out));
  const guide = fs.readFileSync(out, 'utf8');
  for (const heading of ['Delivery Targets', 'Primary Journey', 'Responsive Matrix', 'Parent Constraint Matrix', 'Dynamic State Flow']) {
    assert.match(guide, new RegExp(`^## ${heading}$`, 'm'));
  }
  assert.match(guide, /Parent containers own available width and height/);
  assert.match(guide, /Fill\/grow\/shrink/);
  assert.match(guide, /Min\/max bounds/);
  assert.match(guide, /Scroll owner/);
  assert.match(guide, /Anchors\/alignment/);
  assert.match(guide, /Current state\/route/);
  const scaffoldCheck = runBin('nui-design-guide.mjs', ['check', out], { env });
  assert.equal(scaffoldCheck.status, 1);
  assert.match(scaffoldCheck.stderr, /Selected target IDs|Parent Constraint Matrix/);

  const completedGuide = guide
    .replace('- Selected target IDs:', '- Selected target IDs: ios-swiftui, android-compose')
    .replace(
      '- Add a row for every major region, overlay, repeated collection, and independently scrolling pane.',
      '| Trip results | App shell | Fill available width | Grow from content | Grow and shrink | min 18rem; max 72rem | Document scroll | Start aligned | Stack in compact space; reflow to grid when cards fit |\n- Add a row for every major region, overlay, repeated collection, and independently scrolling pane.',
    );
  fs.writeFileSync(out, completedGuide);
  const check = runBin('nui-design-guide.mjs', ['check', out], { env });
  assert.equal(check.status, 0, check.stderr);

  const incomplete = path.join(dir, 'incomplete-design-guide.md');
  fs.writeFileSync(incomplete, completedGuide.replace('## Parent Constraint Matrix', '## Constraint Notes'));
  const rejected = runBin('nui-design-guide.mjs', ['check', incomplete], { env });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Parent Constraint Matrix/);
});

test('nui-design-guide scaffolds surface-aware responsive defaults', () => {
  const { env } = unconfiguredEnv();
  for (const [surface, expected, targetGuidance] of [
    ['mobile', /flagship native pair/, /Rust mobile.*shared Rust runtime.*C# mobile.*\.NET teams/i],
    ['web', /narrow phone browser through large desktop/i, /React Router.*Nuxt\/Vue.*Angular.*Astro.*static or SSR.*Static is a delivery mode.*never a reduction.*manifest capabilities/i],
    ['desktop', /minimum supported window through maximized\/ultrawide/i, /default.*rust-desktop.*csharp-desktop.*macOS SwiftUI.*separately scoped\/new.*macos-swiftui.*No macOS SwiftUI exporter/i],
  ]) {
    const dir = tmpdir();
    const out = path.join(dir, `${surface}-design-guide.md`);
    const init = runBin('nui-design-guide.mjs', ['init', '-o', out, '--prompt', `${surface} trips app`], { env });
    assert.equal(init.status, 0, init.stderr);
    const guide = fs.readFileSync(out, 'utf8');
    assert.match(guide, expected);
    assert.match(guide, targetGuidance);
    assert.doesNotMatch(guide, /Single column by default|Fluid single column, then/i);
  }

  const macDir = tmpdir();
  const macGuide = path.join(macDir, 'macos-swiftui-design-guide.md');
  const macInit = runBin('nui-design-guide.mjs', [
    'init', '-o', macGuide, '--prompt', 'Build a macOS SwiftUI desktop app',
  ], { env });
  assert.equal(macInit.status, 0, macInit.stderr);
  const macText = fs.readFileSync(macGuide, 'utf8');
  assert.match(macText, /Inferred surface intent: desktop/);
  assert.doesNotMatch(macText, /Inferred surface intent: mobile|Mobile default: flagship native pair/);
  assert.match(macText, /macOS SwiftUI.*separately scoped\/new `macos-swiftui` exporter/i);
  assert.doesNotMatch(macText, /minimum, preferred, and maximum supported viewport/i);
});

test('nui-architecture requires approval when asked', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'nativeui-architecture.md');
  const { env } = unconfiguredEnv();
  const init = runBin('nui-architecture.mjs', ['init', '-o', out, '--project', path.join(dir, 'project.json')], { env });
  assert.equal(init.status, 0, init.stderr);
  const architecture = fs.readFileSync(out, 'utf8');
  for (const heading of ['Selected Delivery Targets', 'Client Delivery And Hosting']) {
    assert.match(architecture, new RegExp(`^## ${heading}$`, 'm'));
  }
  for (const field of [
    'Web lane',
    'Web render mode',
    'Desktop operating systems and CPU architectures',
    'Client routes and direct-load behavior',
    'Base path and trailing-slash policy',
    'static assets/CDN or Node SSR',
    'API origin',
    'CORS allowed origins',
    'Cookie domain',
    'Offline fallback',
    'Cache strategy',
    'distribution package',
    'Signing, notarization',
  ]) {
    assert.match(architecture, new RegExp(field, 'i'));
  }
  const incomplete = path.join(dir, 'incomplete-architecture.md');
  fs.writeFileSync(incomplete, architecture.replace('## Client Delivery And Hosting', '## Client Notes'));
  const rejected = runBin('nui-architecture.mjs', ['check', incomplete], { env });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Client Delivery And Hosting/);

  const unapproved = runBin('nui-architecture.mjs', ['check', out, '--require-approved'], { env });
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stderr, /not approved/i);

  const approvedScaffold = fs.readFileSync(out, 'utf8')
    .replace('- [ ] User approved this architecture for implementation.', '- [x] User approved this architecture for implementation.');
  fs.writeFileSync(out, approvedScaffold);
  const unresolved = runBin('nui-architecture.mjs', ['check', out, '--require-approved'], { env });
  assert.equal(unresolved.status, 1);
  assert.match(unresolved.stderr, /unresolved required decision|Selected target IDs/i);

  const text = approvedScaffold
    .replace('- Target IDs:', '- Target IDs: ios-swiftui, android-compose')
    .replace('- Responsive parent-constraint, scroll-owner, and structural reflow implications:', '- Responsive parent-constraint, scroll-owner, and structural reflow implications: viewport owns the fluid app shell; document owns vertical scroll; content stacks when its minimum card width no longer fits')
    .replace('- Stack: Undecided until audit/user approval.', '- Stack: Node 24 with Hono and PostgreSQL.')
    .replace('- Command:', '- Command: npm run dev')
    .replace('- API origin, base path, versioning, and environment switching:', '- API origin, base path, versioning, and environment switching: https://api.example.test/v1 via environment configuration')
    .replace('- Authentication/session model and redirect/callback origins:', '- Authentication/session model and redirect/callback origins: bearer access token; no browser callback')
    .replace('- Target: Undecided until audit/user approval.', '- Target: Cloud Run')
    .replace('- Backend path:', '- Backend path: backend/')
    .replace('- Routes:', '- Routes: GET /health, POST /api/trips');
  fs.writeFileSync(out, text);
  const approved = runBin('nui-architecture.mjs', ['check', out, '--require-approved'], { env });
  assert.equal(approved.status, 0, approved.stderr);
});
