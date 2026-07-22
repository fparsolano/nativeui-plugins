import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';
import { analyzeHtmlResponsiveSource } from '../bin/nui-responsive-audit.mjs';
import { analyzeHtmlFlowSource } from '../bin/nui-flow-audit.mjs';

const REQUIRED_SKILLS = ['nativeui', 'nativeui-app', 'nativeui-design', 'nativeui-update', 'nativeui-review', 'nativeui-developer'];

test('every design workflow enforces responsive and dynamic output', () => {
  for (const name of REQUIRED_SKILLS) {
    const file = path.join(PLUGIN_DIR, 'skills', name, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /responsive/i, `${name} must require responsive design`);
    assert.match(text, /dynamic[\s\S]{0,160}(?:flow|journey|interactions)/i, `${name} must require dynamic flow`);
  }
  for (const name of ['nativeui', 'nativeui-app', 'nativeui-design', 'nativeui-update']) {
    const text = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(text, /nui-responsive-audit\.mjs/, `${name} must run the responsive gate`);
    assert.match(text, /nui-flow-audit\.mjs/, `${name} must run the flow gate`);
    assert.match(text, /parent(?:-| )(?:constraint|constraints|constrained)|owning parent|resolves from its parent/i,
      `${name} must define parent-owned layout constraints`);
  }

  const guide = fs.readFileSync(path.join(PLUGIN_DIR, 'bin', 'nui-design-guide.mjs'), 'utf8');
  assert.match(guide, /Parent Constraint Matrix/);
  assert.match(guide, /Fill\/grow\/shrink/);
  assert.match(guide, /Scroll owner/);
});

test('deprecated audit opt-out cannot bypass responsive review or be confused with static web builds', () => {
  const responsive = fs.readFileSync(path.join(PLUGIN_DIR, 'bin', 'nui-responsive-audit.mjs'), 'utf8');
  const review = fs.readFileSync(path.join(PLUGIN_DIR, 'bin', 'nui-final-review.mjs'), 'utf8');
  assert.match(responsive, /allowStaticIgnored/);
  assert.match(responsive, /unrelated to a web lane's[\s\S]*static[\s\S]*build\/hosting render mode/i);
  assert.match(review, /responsive\.static-opt-out-ignored/);
  assert.match(review, /unrelated to static web build\/hosting mode/i);
});

test('every bundled authoring example passes responsive and dynamic contracts', () => {
  const examples = path.join(PLUGIN_DIR, 'skills', 'nativeui', 'examples');
  for (const name of fs.readdirSync(examples).filter((file) => file.endsWith('.html')).sort()) {
    const source = fs.readFileSync(path.join(examples, name), 'utf8');
    const responsive = analyzeHtmlResponsiveSource(source, path.join(examples, name));
    const flow = analyzeHtmlFlowSource(source, path.join(examples, name));
    assert.equal(responsive.ok, true, `${name}: ${responsive.warnings.join(' ')}`);
    assert.equal(flow.ok, true, `${name}: ${flow.issues.map((issue) => issue.message).join(' ')}`);
  }
});
