// capabilities-registry.test.mjs - keep agent-facing capability docs and tools in sync.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR } from './helpers.mjs';

test('capability registry references existing files with required terms', () => {
  const registryPath = path.join(PLUGIN_DIR, 'capabilities/nativeui-agent-capabilities.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  assert.equal(registry.version, 2);
  assert.ok(Array.isArray(registry.features));
  assert.ok(registry.features.length >= 8);

  for (const feature of registry.features) {
    assert.match(feature.id, /^[a-z0-9-]+$/);
    assert.ok(Array.isArray(feature.rules), `${feature.id} must list behavior rules`);
    assert.ok(feature.rules.length > 0, `${feature.id} must include at least one rule`);
    assert.ok(Array.isArray(feature.tools), `${feature.id} must list tools`);
    assert.ok(Array.isArray(feature.files), `${feature.id} must list files`);
    assert.ok(Array.isArray(feature.tests), `${feature.id} must list tests`);
    assert.ok(feature.files.length > 0, `${feature.id} must reference at least one file`);
    assert.ok(feature.tests.length > 0, `${feature.id} must reference at least one test`);

    for (const tool of feature.tools) {
      const full = path.join(PLUGIN_DIR, 'bin', tool);
      assert.ok(fs.existsSync(full), `${feature.id} references missing tool ${tool}`);
    }

    const featureTexts = [];
    for (const entry of feature.files) {
      const file = typeof entry === 'string' ? entry : entry.path;
      const terms = typeof entry === 'string' ? feature.terms || [] : entry.terms || [];
      assert.ok(file, `${feature.id} file entries must include a path`);
      assert.ok(Array.isArray(terms), `${feature.id} ${file} must list terms`);
      assert.ok(terms.length > 0, `${feature.id} ${file} must include at least one term`);
      const full = path.join(PLUGIN_DIR, file);
      assert.ok(fs.existsSync(full), `${feature.id} references missing file ${file}`);
      const text = fs.readFileSync(full, 'utf8').toLowerCase();
      featureTexts.push(text);
      for (const term of terms) {
        assert.ok(
          text.includes(term.toLowerCase()),
          `${feature.id} expected ${file} to mention "${term}"`,
        );
      }
    }

    for (const testFile of feature.tests) {
      const full = path.join(PLUGIN_DIR, testFile);
      assert.ok(fs.existsSync(full), `${feature.id} references missing test ${testFile}`);
    }

    for (const gate of feature.reviewGates || []) {
      const found = featureTexts.some((text) => text.includes(String(gate).toLowerCase()));
      assert.ok(found, `${feature.id} review gate "${gate}" must appear in referenced files`);
    }
  }
});
