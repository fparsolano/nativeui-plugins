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
  assert.match(manifest.description, /Requires NativeUI beta access/);
  assert.match(manifest.interface.shortDescription, /Requires NativeUI beta access/);
  assert.match(manifest.interface.longDescription, /NativeUI beta access is required/);
  assert.equal(Object.hasOwn(manifest, 'apps'), false);
  assert.equal(Object.hasOwn(manifest, 'mcpServers'), false);

  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/admin/codex-requirements.nativeui.example.toml')));
  assert.ok(fs.existsSync(path.join(out, 'plugins/nativeui/bin/nui-export.mjs')));
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
