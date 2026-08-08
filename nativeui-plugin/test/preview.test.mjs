// preview.test.mjs — nui-preview.mjs importable helpers (arg parsing + URL derivation).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, webEditorUrl, profileApiBase } from '../bin/nui-preview.mjs';

test('parseArgs: requires a file', () => {
  assert.throws(() => parseArgs([]), /No project file given/);
});

test('parseArgs: requires --name when saving', () => {
  assert.throws(() => parseArgs(['p.json']), /name is required/i);
});

test('parseArgs: --no-save drops the name requirement', () => {
  const a = parseArgs(['p.json', '--no-save']);
  assert.equal(a.save, false);
  assert.equal(a.file, 'p.json');
});

test('parseArgs: parses name/location/open', () => {
  const a = parseArgs(['p.json', '--name', 'My App', '--location', 'Folder', '--open']);
  assert.deepEqual(a, { file: 'p.json', name: 'My App', location: 'Folder', open: true, save: true });
});

test('parseArgs: unknown flag throws', () => {
  assert.throws(() => parseArgs(['p.json', '--name', 'x', '--zzz']), /Unknown flag/);
});

test('webEditorUrl: prefixes webapp. on the export host', () => {
  assert.equal(webEditorUrl({ exportServiceUrl: 'https://dev.nativeui.com' }), 'https://webapp.dev.nativeui.com');
  assert.equal(webEditorUrl({ exportServiceUrl: 'https://nativeui.com' }), 'https://webapp.nativeui.com');
});

test('webEditorUrl: leaves an already-webapp host as-is', () => {
  assert.equal(webEditorUrl({ exportServiceUrl: 'https://webapp.dev.nativeui.com' }), 'https://webapp.dev.nativeui.com');
});

test('webEditorUrl: env override wins', () => {
  process.env.NATIVEUI_WEB_EDITOR_URL = 'https://my.editor.example/';
  try {
    assert.equal(webEditorUrl({ exportServiceUrl: 'https://dev.nativeui.com' }), 'https://my.editor.example');
  } finally {
    delete process.env.NATIVEUI_WEB_EDITOR_URL;
  }
});

test('webEditorUrl: non-URL export host yields empty (caller falls back)', () => {
  assert.equal(webEditorUrl({ exportServiceUrl: 'not a url' }), '');
});

test('profileApiBase: defaults to <export>/api/profile, env override wins', () => {
  assert.equal(profileApiBase({ exportServiceUrl: 'https://dev.nativeui.com' }), 'https://dev.nativeui.com/api/profile');
  process.env.NATIVEUI_PROFILE_API_URL = 'https://prof.example/api/profile/';
  try {
    assert.equal(profileApiBase({ exportServiceUrl: 'https://dev.nativeui.com' }), 'https://prof.example/api/profile');
  } finally {
    delete process.env.NATIVEUI_PROFILE_API_URL;
  }
});
