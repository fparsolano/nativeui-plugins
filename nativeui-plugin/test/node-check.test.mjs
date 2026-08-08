// node-check.test.mjs — every bin/*.mjs parses cleanly (node --check). This is the
// same gate the CI runs; keeping it in the suite catches a syntax slip locally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BIN_DIR } from './helpers.mjs';

const binFiles = fs
  .readdirSync(BIN_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => path.join(BIN_DIR, f));

test('there is at least one bin to check', () => {
  assert.ok(binFiles.length >= 1);
});

for (const file of binFiles) {
  test(`node --check ${path.basename(file)}`, () => {
    const r = spawnSync('node', ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `node --check failed for ${file}:\n${r.stderr}`);
  });
}
