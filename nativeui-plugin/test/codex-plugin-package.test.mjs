// codex-plugin-package.test.mjs — Codex marketplace bundle generation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNode, PLUGIN_DIR } from './helpers.mjs';

const REPO_ROOT = path.resolve(PLUGIN_DIR, '..');
const GENERATOR = path.join(REPO_ROOT, 'nativeui-codex', 'build-codex-plugin.mjs');

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function snapshot(dir) {
  const files = walkFiles(dir)
    .filter((file) => path.basename(file) !== '.DS_Store')
    .map((file) => path.relative(dir, file))
    .sort();
  return new Map(files.map((file) => [file, fs.readFileSync(path.join(dir, file))]));
}

test('Codex bundle generator creates marketplace, plugin manifest, admin kit, and rewrites Claude placeholders', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-codex-plugin-'));
  const r = runNode(GENERATOR, ['--out', out]);
  assert.equal(r.status, 0, r.stderr);

  const marketplace = JSON.parse(fs.readFileSync(path.join(out, '.agents/plugins/marketplace.json'), 'utf8'));
  assert.equal(marketplace.name, 'nativeui-marketplace');
  assert.equal(marketplace.plugins[0].name, 'nativeui');
  assert.equal(marketplace.plugins[0].source.path, './plugins/nativeui');
  assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(marketplace.plugins[0].policy.authentication, 'ON_INSTALL');

  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'plugins/nativeui/.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'nativeui');
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /parent-constrained/);
  assert.match(manifest.description, /five authored web lanes/);
  assert.match(manifest.interface.shortDescription, /every NativeUI target/);
  assert.match(manifest.interface.longDescription, /HTML, React, Vue, Angular, and Astro/);
  assert.match(manifest.version, /^0\.2\.0\+codex\.[0-9]+$/);
  assert.equal(manifest.interface.defaultPrompt.length, 3);
  for (const prompt of manifest.interface.defaultPrompt) {
    assert.ok(prompt.length <= 128, `default prompt exceeds Codex's 128-character limit: ${prompt}`);
  }
  assert.match(manifest.interface.defaultPrompt[0], /flagship SwiftUI plus Compose.*Rust and C#/i);
  assert.match(manifest.interface.defaultPrompt[1], /responsive, dynamic.*HTML, React, Vue, Angular, or Astro.*static or SSR.*HTML static/i);
  assert.match(manifest.interface.defaultPrompt[2], /Default to Rust.*C#.*macOS SwiftUI is unavailable.*new exporter/i);
  assert.equal(manifest.interface.composerIcon, './assets/nativeui-icon.png');
  assert.equal(Object.hasOwn(manifest, 'apps'), false);
  assert.equal(Object.hasOwn(manifest, 'mcpServers'), false);

  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/admin/codex-requirements.nativeui.example.toml')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/bin/nui-export.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/bin/nui-editor.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/bin/nui-release.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/bin/nui-flow-audit.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/capabilities/nativeui-targets.json')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/skills/nativeui/references/delivery-targets.md')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/assets/nativeui-logo.svg')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/skills/nativeui/SKILL.md')));

  for (const file of walkFiles(path.join(out, 'plugins/nativeui'))) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('CLAUDE_SKILL_DIR'), false, `${file} still contains CLAUDE_SKILL_DIR`);
  }

  const primarySkill = fs.readFileSync(path.join(out, 'plugins/nativeui/skills/nativeui/SKILL.md'), 'utf8');
  assert.match(primarySkill, /Codex plugin path note/);
  assert.match(primarySkill, /Tenant policy \/ external disclosure denial/);
});

test('committed Codex plugin and marketplace are fresh from the shared source', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-codex-freshness-'));
  const r = runNode(GENERATOR, ['--out', out]);
  assert.equal(r.status, 0, r.stderr);

  const expected = snapshot(path.join(out, 'plugins/nativeui'));
  const committed = snapshot(path.join(REPO_ROOT, 'plugins/nativeui'));
  assert.deepEqual([...committed.keys()], [...expected.keys()], 'committed plugin file list is stale');
  for (const [file, bytes] of expected) {
    assert.ok(committed.get(file)?.equals(bytes), `committed plugin file is stale: ${file}`);
  }

  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents/plugins/marketplace.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(out, '.agents/plugins/marketplace.json'), 'utf8')),
  );
});
