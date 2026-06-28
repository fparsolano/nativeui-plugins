// no-local-firebase-auth.test.mjs — the CLI ships no local Firebase web API key/config.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BIN_DIR } from './helpers.mjs';

function readBinFiles() {
  return fs
    .readdirSync(BIN_DIR)
    .filter((name) => /\.(mjs|json|md)$/.test(name))
    .map((name) => [name, fs.readFileSync(path.join(BIN_DIR, name), 'utf8')]);
}

test('CLI bin files do not contain local Firebase auth config or Google token endpoints', () => {
  for (const [name, text] of readBinFiles()) {
    assert.doesNotMatch(text, /AIza[0-9A-Za-z_-]+/, `${name} contains a Firebase-looking web API key`);
    assert.doesNotMatch(text, /NATIVEUI_FIREBASE_/i, `${name} contains local Firebase env config`);
    assert.doesNotMatch(text, /identitytoolkit\.googleapis\.com/i, `${name} calls Identity Toolkit locally`);
    assert.doesNotMatch(text, /securetoken\.googleapis\.com/i, `${name} calls Secure Token locally`);
  }
});
