// skill-schema.test.mjs - keep every NativeUI skill valid for Codex discovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';

const SKILLS_DIR = path.join(PLUGIN_DIR, 'skills');
const ALLOWED_FRONTMATTER_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);

function skillDirs() {
  return fs.readdirSync(SKILLS_DIR)
    .map((name) => path.join(SKILLS_DIR, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'SKILL.md')))
    .sort();
}

function frontmatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${file} must start with YAML frontmatter`);
  return match[1];
}

function topLevelKeys(yaml) {
  return yaml
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z0-9_-]+:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')));
}

function frontmatterValue(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

test('all skills use Codex-valid frontmatter and OpenAI metadata', () => {
  const dirs = skillDirs();
  assert.equal(dirs.length, 14);
  for (const dir of dirs) {
    const file = path.join(dir, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    const yaml = frontmatter(text, file);
    const name = frontmatterValue(yaml, 'name');
    assert.equal(name, path.basename(dir), `${file} name must match directory`);
    assert.doesNotMatch(yaml, /^argument-hint:/m, `${file} must not use unsupported argument-hint frontmatter`);
    for (const key of topLevelKeys(yaml)) {
      assert.ok(ALLOWED_FRONTMATTER_KEYS.has(key), `${file} has unsupported frontmatter key ${key}`);
    }
    assert.match(yaml, /^metadata:\n(?:  .+\n?)+/m, `${file} should preserve target hints under metadata`);

    const metadata = path.join(dir, 'agents/openai.yaml');
    assert.ok(fs.existsSync(metadata), `${name} must include agents/openai.yaml`);
    const metadataText = fs.readFileSync(metadata, 'utf8');
    assert.match(metadataText, /display_name:\s*"[^"]+"/, `${metadata} must include display_name`);
    assert.match(metadataText, /short_description:\s*"[^"]+"/, `${metadata} must include short_description`);
    assert.match(metadataText, new RegExp(`default_prompt: ".*\\$${name}.*"`), `${metadata} default_prompt should invoke $${name}`);
  }
});
