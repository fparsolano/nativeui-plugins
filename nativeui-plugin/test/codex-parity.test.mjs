// codex-parity.test.mjs — Codex is the NativeUI agent source of truth; Claude mirrors it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

test('Codex installer propagates the mirrored developer skill and shared bin tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-codex-install-'));
  const skillsDir = path.join(dir, 'skills');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const bash = process.platform === 'win32' && fs.existsSync(gitBash) ? gitBash : 'bash';
  const r = spawnSync(bash, [path.join(ROOT, 'nativeui-codex/install.sh')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      HOME: home,
      CODEX_SKILLS_DIR: skillsDir,
      NATIVEUI_PLUGIN_DIR: PLUGIN_DIR,
    },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(fs.existsSync(path.join(skillsDir, 'nativeui-developer/SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillsDir, 'nativeui/bin/nui-project-sync.mjs')));
  assert.ok(fs.existsSync(path.join(skillsDir, 'nativeui/bin/nui-library.mjs')));
  const installed = fs.readFileSync(path.join(skillsDir, 'nativeui-developer/SKILL.md'), 'utf8');
  assert.ok(!installed.includes('CLAUDE_SKILL_DIR'));
  assert.match(installed.replaceAll('\\', '/'), /\/nativeui\/bin/);
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
