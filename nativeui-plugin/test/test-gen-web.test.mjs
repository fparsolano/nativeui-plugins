import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { genWeb, parseArgs } from '../bin/nui-test-gen.mjs';
import { resolveTargets } from '../bin/target-contract.mjs';

test('legacy --platform web selects the vanilla web-html lane', () => {
  const parsed = parseArgs(['project.json', '--platform', 'web', '--out', './web-out']);
  assert.equal(parsed.platform, 'web');
  assert.deepEqual(parsed.selectedTargets.map((target) => target.id), ['web-html']);
});

test('web-all emits lane-native action contract tests at runnable locations', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-testgen-web-'));
  for (const target of resolveTargets(['web-all'])) {
    await genWeb(path.join(out, target.id), target);
  }

  const expected = {
    'web-html': ['tests/app-actions.contract.test.mjs', "from '../app-actions.js'"],
    'web-react': ['tests/app-actions.contract.test.ts', "from '../app/seams/app-actions'"],
    'web-vue': ['tests/app-actions.contract.test.ts', "from '../app/seams/app-actions'"],
    'web-angular': ['src/app/app-actions.contract.spec.ts', "from './seams/app-actions'"],
    'web-astro': ['tests/app-actions.contract.test.ts', "from '../src/seams/app-actions'"],
  };

  for (const [targetId, [relative, importLine]] of Object.entries(expected)) {
    const file = path.join(out, targetId, ...relative.split('/'));
    assert.ok(fs.existsSync(file), `${targetId}: ${relative}`);
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.includes(importLine), `${targetId}: ${importLine}`);
    if (targetId === 'web-html') {
      assert.match(source, /application handler surface/);
      assert.doesNotMatch(source, /await appActions\./);
    } else {
      assert.doesNotMatch(source, /\.\.\/app-actions\.js/, `${targetId} must not fall back to the vanilla seam`);
      assert.match(source, /satisfies Record<string, AsyncAction>/);
      assert.match(source, /contracts'/);
      assert.match(source, /without invoking application effects/);
    }
  }
});
