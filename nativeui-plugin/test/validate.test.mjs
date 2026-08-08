// validate.test.mjs — nui-validate.mjs structural validation (good vs broken),
// driven via --structural so no token/network is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBin, fixture, unconfiguredEnv } from './helpers.mjs';

test('structural: a well-formed project passes (exit 0)', () => {
  const { env } = unconfiguredEnv(); // structural-only never touches config
  const r = runBin('nui-validate.mjs', [fixture('good-project.json'), '--structural'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK:/);
  assert.match(r.stdout, /SKIPPED \(--structural\)/);
});

test('structural: a broken project FAILS with specific problems (exit 1)', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', [fixture('broken-project.json'), '--structural'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INVALID/);
  // unknown kind flagged:
  assert.match(r.stderr, /unknown "kind"/);
  // letter-first id rule flagged ("1bad"):
  assert.match(r.stderr, /letter-first|start with a letter/i);
  // type slip on layoutX (string, not number):
  assert.match(r.stderr, /layoutX/);
  // version out of range (9):
  assert.match(r.stderr, /version/);
  // empty rootNodes on the second stage:
  assert.match(r.stderr, /rootNodes/);
});

test('fail-closed: missing project file -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', ['/no/such/project.json', '--structural'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found/);
});

test('fail-closed: no project argument -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', ['--structural'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Missing <project.json>/);
});

test('fail-closed: unknown flag -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', [fixture('good-project.json'), '--bogus'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown flag/);
});

test('fail-closed: bad --platform value -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', [fixture('good-project.json'), '--platform', 'windows', '--structural'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be 'android' or 'ios'/);
});

test('without --structural and no config, the model check cannot run -> exit 1 (fail-closed)', () => {
  // Structural passes, but the authoritative model round-trip needs config+auth; with
  // neither it must exit non-zero rather than claim "valid".
  const { env } = unconfiguredEnv();
  const r = runBin('nui-validate.mjs', [fixture('good-project.json')], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could NOT run|not configured|Not logged in/i);
});
