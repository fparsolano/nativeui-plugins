// no-local-firebase-auth.test.mjs — the CLI ships no local Firebase web API key/config.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BIN_DIR } from './helpers.mjs';

function readSourceFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) return readSourceFiles(full, name);
    return /\.(mjs|json|md)$/.test(entry.name) ? [[name, fs.readFileSync(full, 'utf8')]] : [];
  });
}

test('CLI, shared library, and MCP files do not contain local Firebase auth config or Google token endpoints', () => {
  const plugin = path.resolve(BIN_DIR, '..');
  for (const [name, text] of [
    ...readSourceFiles(BIN_DIR, 'bin'),
    ...readSourceFiles(path.join(plugin, 'lib'), 'lib'),
    ...readSourceFiles(path.join(plugin, 'mcp'), 'mcp'),
  ]) {
    assert.doesNotMatch(text, /AIza[0-9A-Za-z_-]+/, `${name} contains a Firebase-looking web API key`);
    assert.doesNotMatch(text, /NATIVEUI_FIREBASE_/i, `${name} contains local Firebase env config`);
    assert.doesNotMatch(text, /identitytoolkit\.googleapis\.com/i, `${name} calls Identity Toolkit locally`);
    assert.doesNotMatch(text, /securetoken\.googleapis\.com/i, `${name} calls Secure Token locally`);
  }
});
