// codex-parity.test.mjs — Codex is the NativeUI agent source of truth; Claude mirrors it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';

const ROOT = path.resolve(PLUGIN_DIR, '..');
const CANONICAL = path.join(ROOT, 'nativeui-codex/canonical/nativeui-developer/SKILL.md');
const CLAUDE_MIRROR = path.join(PLUGIN_DIR, 'skills/nativeui-developer/SKILL.md');

test('Codex canonical developer skill is mirrored byte-for-byte into Claude plugin', () => {
  const canonical = fs.readFileSync(CANONICAL, 'utf8');
  const mirror = fs.readFileSync(CLAUDE_MIRROR, 'utf8');
  assert.equal(mirror, canonical);
  for (const required of [
    'Codex owns this canonical contract',
    'mobile-flagship',
    'web-html',
    'web-react',
    'Nuxt/Vue',
    'Angular',
    'Astro',
    'static/SSR',
    'rust-desktop',
    'macOS SwiftUI',
    'separately scoped/new',
    'parent that owns',
    'Register API/database definitions in `libraryItems[]`',
    'Store secrets only in account secret storage',
    'guarded editor/project synchronization',
    'nui-editor handoff|resume|publish',
    'nui-library.mjs',
    'nui-final-review --target',
    'NuiActionResult',
    'nativeui-export-manifest.json',
  ]) {
    assert.ok(canonical.includes(required), `missing canonical rule: ${required}`);
  }
});

test('mirror sync script ships both Codex canonical package and Claude plugin', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/sync-plugins-mirror.sh'), 'utf8');
  assert.ok(script.includes('nativeui-plugin/'));
  assert.ok(script.includes('nativeui-codex/'));
  assert.ok(script.includes('build-codex-plugin.mjs'));
  assert.ok(script.includes('.agents/plugins/marketplace.json'));
  assert.ok(script.includes('plugins/nativeui/'));
  assert.ok(script.includes('codex-bootstrap.sh'));
});
