// config.test.mjs — config.mjs merge/precedence + fail-closed.
//
// getConfig() reads ~/.nativeui/config.json (HOME-based) and merges service host
// env overrides over it, field by field. We drive it in a child process with a
// controlled HOME + env so the precedence is observable, without touching the
// real ~/.nativeui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bin, runNode } from './helpers.mjs';

// A tiny harness script that prints getConfig() as JSON (or "ERR:<name>" on throw).
const PROBE_SRC = `
import { getConfig } from ${JSON.stringify(pathToFileURL(bin('config.mjs')).href)};
getConfig().then(
  (c) => { process.stdout.write(JSON.stringify(c)); },
  (e) => { process.stdout.write('ERR:' + e.name); }
);
`;

function withHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-cfg-'));
  fs.mkdirSync(path.join(home, '.nativeui'), { recursive: true });
  if (files && files['config.json'] !== undefined) {
    fs.writeFileSync(path.join(home, '.nativeui', 'config.json'), files['config.json']);
  }
  return home;
}

function cleanEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (k.startsWith('NATIVEUI_')) delete env[k];
  return { ...env, ...extra };
}

function run(home, extraEnv) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-cfg-probe-'));
  const probe = path.join(probeDir, 'config-probe.mjs');
  fs.writeFileSync(probe, PROBE_SRC);
  try {
    const r = runNode(probe, [], { env: cleanEnv(home, extraEnv) });
    return r.stdout.trim();
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

const FULL_FILE = JSON.stringify({
  exportServiceUrl: 'https://file.example.com',
  billingApiUrl: 'https://file.example.com/api/billing',
  exportAuthMode: 'nativeui',
});

test('zero config -> baked NativeUI service defaults (SSO-only; no config needed)', () => {
  const home = withHome({});
  const c = JSON.parse(run(home));
  assert.equal(Object.hasOwn(c, 'firebase'), false);
  assert.equal(c.exportServiceUrl, 'https://dev.nativeui.com');
  assert.equal(c.billingApiUrl, 'https://dev.nativeui.com/api/billing');
  assert.equal(c.exportAuthMode, 'nativeui');
});

test('fail-closed: invalid JSON config file -> ConfigError', () => {
  const home = withHome({ 'config.json': '{ not json' });
  assert.equal(run(home), 'ERR:ConfigError');
});

test('file-only config is loaded and validated', () => {
  const home = withHome({ 'config.json': FULL_FILE });
  const out = run(home);
  const c = JSON.parse(out);
  assert.equal(Object.hasOwn(c, 'firebase'), false);
  assert.equal(c.exportServiceUrl, 'https://file.example.com');
  assert.equal(c.billingApiUrl, 'https://file.example.com/api/billing');
  assert.equal(c.exportAuthMode, 'nativeui');
});

test('env overrides the file FIELD BY FIELD (env wins)', () => {
  const home = withHome({ 'config.json': FULL_FILE });
  const out = run(home, {
    NATIVEUI_EXPORT_SERVICE_URL: 'https://env.example.com',
  });
  const c = JSON.parse(out);
  // overridden by env:
  assert.equal(c.exportServiceUrl, 'https://env.example.com');
  // untouched fields fall back to the file:
  assert.equal(c.billingApiUrl, 'https://file.example.com/api/billing');
  assert.equal(c.exportAuthMode, 'nativeui');
});

test('env-only config (no file) is sufficient', () => {
  const home = withHome({});
  const out = run(home, {
    NATIVEUI_EXPORT_SERVICE_URL: 'https://env-only.example.com/',
    NATIVEUI_BILLING_API_URL: 'https://env-only.example.com/api/billing/',
  });
  const c = JSON.parse(out);
  assert.equal(Object.hasOwn(c, 'firebase'), false);
  // trailing slashes are trimmed:
  assert.equal(c.exportServiceUrl, 'https://env-only.example.com');
  assert.equal(c.billingApiUrl, 'https://env-only.example.com/api/billing');
  assert.equal(c.exportAuthMode, 'nativeui');
});

test('partial override wins per-field; the rest fall back to the baked defaults', () => {
  const home = withHome({});
  const c = JSON.parse(
    run(home, {
      NATIVEUI_EXPORT_SERVICE_URL: 'https://override.example.com',
      // no billing host -> default fills it in
    })
  );
  assert.equal(c.exportServiceUrl, 'https://override.example.com'); // override wins
  assert.equal(c.billingApiUrl, 'https://dev.nativeui.com/api/billing'); // default
  assert.equal(c.exportAuthMode, 'nativeui');
});

test('exportAuthMode can be set by file or env', () => {
  const home = withHome({
    'config.json': JSON.stringify({
      exportServiceUrl: 'https://internal.example.com',
      exportAuthMode: 'none',
    }),
  });
  const c = JSON.parse(run(home));
  assert.equal(c.exportServiceUrl, 'https://internal.example.com');
  assert.equal(c.exportAuthMode, 'none');

  const overridden = JSON.parse(run(home, { NATIVEUI_EXPORT_AUTH_MODE: 'nativeui' }));
  assert.equal(overridden.exportAuthMode, 'nativeui');
});

test('export-only mode allows billingApiUrl to be omitted or blank', () => {
  const home = withHome({
    'config.json': JSON.stringify({
      exportServiceUrl: 'https://nativeui-export.internal.example.com',
      billingApiUrl: '',
      exportAuthMode: 'none',
    }),
  });
  const c = JSON.parse(run(home));
  assert.equal(c.exportServiceUrl, 'https://nativeui-export.internal.example.com');
  assert.equal(c.billingApiUrl, '');
  assert.equal(c.exportAuthMode, 'none');
});

test('hosted mode still rejects blank billingApiUrl overrides', () => {
  const home = withHome({
    'config.json': JSON.stringify({
      exportServiceUrl: 'https://file.example.com',
      billingApiUrl: '',
      exportAuthMode: 'nativeui',
    }),
  });
  assert.equal(run(home), 'ERR:ConfigError');
});

test('invalid exportAuthMode fails closed', () => {
  const home = withHome({
    'config.json': JSON.stringify({
      exportServiceUrl: 'https://file.example.com',
      exportAuthMode: 'magic',
    }),
  });
  assert.equal(run(home), 'ERR:ConfigError');
});

test('legacy firebase config fields are ignored locally', () => {
  const home = withHome({
    'config.json': JSON.stringify({
      firebase: { apiKey: 'file-key', authDomain: 'file.firebaseapp.com', projectId: 'file-proj' },
      exportServiceUrl: 'https://file.example.com',
    }),
  });
  const c = JSON.parse(run(home, { NATIVEUI_FIREBASE_API_KEY: 'env-key' }));
  assert.equal(Object.hasOwn(c, 'firebase'), false);
  assert.equal(JSON.stringify(c).includes('file-key'), false);
  assert.equal(JSON.stringify(c).includes('env-key'), false);
  assert.equal(c.exportServiceUrl, 'https://file.example.com');
});
