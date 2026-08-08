// skill-inventory.test.mjs - keep the NativeUI plugin skill surface discoverable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';

test('nativeui-design skill is present and routed', () => {
  const skillsDir = path.join(PLUGIN_DIR, 'skills');
  const skillNames = fs.readdirSync(skillsDir)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();

  assert.ok(skillNames.includes('nativeui-design'));
  assert.ok(skillNames.length >= 14);

  const designSkill = fs.readFileSync(path.join(skillsDir, 'nativeui-design/SKILL.md'), 'utf8');
  assert.match(designSkill, /plain, interaction-free, or non-responsive HTML/);
  assert.match(designSkill, /nativeui-design-guide\.md/);
  assert.match(designSkill, /portrait\/landscape/);
  assert.doesNotMatch(designSkill, /\[TODO:/);

  const metadata = fs.readFileSync(path.join(skillsDir, 'nativeui-design/agents/openai.yaml'), 'utf8');
  assert.match(metadata, /display_name: "NativeUI Design"/);
  assert.match(metadata, /\$nativeui-design/);

  for (const file of [
    'skills/nativeui/SKILL.md',
    'skills/nativeui-app/SKILL.md',
    'skills/nativeui-update/SKILL.md',
    'skills/nativeui-intake/SKILL.md',
    'README.md',
  ]) {
    const text = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
    assert.match(text, /nativeui-design/, `${file} should route to nativeui-design`);
    assert.match(text, /styling guide/, `${file} should mention the styling guide output`);
  }
});

test('nativeui-architect skill is present and routed', () => {
  const skillsDir = path.join(PLUGIN_DIR, 'skills');
  const skillNames = fs.readdirSync(skillsDir)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();

  assert.ok(skillNames.includes('nativeui-architect'));

  const architectSkill = fs.readFileSync(path.join(skillsDir, 'nativeui-architect/SKILL.md'), 'utf8');
  assert.match(architectSkill, /nativeui-architecture\.md/);
  assert.match(architectSkill, /Local backend/);
  assert.match(architectSkill, /deployment/);
  assert.match(architectSkill, /approval/i);
  assert.doesNotMatch(architectSkill, /\[TODO:/);

  const metadata = fs.readFileSync(path.join(skillsDir, 'nativeui-architect/agents/openai.yaml'), 'utf8');
  assert.match(metadata, /display_name: "NativeUI Architect"/);
  assert.match(metadata, /\$nativeui-architect/);

  for (const file of [
    'skills/nativeui/SKILL.md',
    'skills/nativeui-backend/SKILL.md',
    'skills/nativeui-developer/SKILL.md',
    'README.md',
  ]) {
    const text = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
    assert.match(text, /nativeui-architect/, `${file} should route to nativeui-architect`);
    assert.match(text, /nativeui-architecture\.md/, `${file} should mention the architecture decision record`);
  }
});
