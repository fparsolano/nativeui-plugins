// connectors-plan.test.mjs - nui-connectors-plan.mjs keeps backend logic in
// durable connector classes instead of generated UI or bulky NuiBackend files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBin, fixture, unconfiguredEnv } from './helpers.mjs';

const PROJECT = fixture('backend-plan.project.json');

function planJson() {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--json'], { env });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('groups a stage into a durable connector class with target paths', () => {
  const plan = planJson();
  assert.equal(plan.summary.connectorCount, 1);
  const c = plan.connectors[0];
  assert.equal(c.connectorName, 'LoginBackendConnector');
  assert.match(c.android.targetPath, /LoginBackendConnector\.kt$/);
  assert.match(c.ios.targetPath, /LoginBackendConnector\.swift$/);
  assert.match(plan.backendBoundary.rule, /NuiBackend files remain thin/i);
});

test('collects controls and preserves Android digit-first typed-accessor rules', () => {
  const c = planJson().connectors[0];
  const ids = c.controls.map((x) => x.id);
  assert.ok(ids.includes('email_field'));
  assert.ok(ids.includes('password_field'));
  const email = c.controls.find((x) => x.id === 'email_field');
  assert.equal(email.androidAccessor, 'emailField');
  assert.equal(email.iosAccessor, 'emailField');
  assert.equal(email.androidTyped, true);
});

test('derives API and form endpoints from interactions/library items', () => {
  const c = planJson().connectors[0];
  assert.ok(c.endpoints.find((e) => e.method === 'GET' && e.path === '/api/profile'));
  assert.ok(c.endpoints.find((e) => e.method === 'POST' && e.path === '/auth/login'));
  assert.ok(c.endpoints.find((e) => e.method === 'GET' && e.path === '/api/results'));
  assert.ok(c.databases.find((d) => d.op === 'query' && d.collection === 'posts'));
  const repeater = c.repeaters.find((r) => r.nodeId === 'results_list' && r.adapterId === 'adapter-results' && r.libraryItemId === 'lib-api-results');
  assert.ok(repeater);
  assert.equal(repeater.runtimeBindingKey, 'adapter-results');
  assert.equal(repeater.runtimeHelpers.android, 'controls.bindRepeater("adapter-results", rows)');
  assert.equal(repeater.runtimeHelpers.ios, 'controls.bindRepeater("adapter-results", rows)');
  assert.ok(c.connectorEvents.find((e) => e.action === 'CALL_API'));
  assert.ok(c.connectorEvents.find((e) => e.action === 'SUBMIT_FORM'));
});

test('--human renders a readable connector plan', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--human'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NativeUI connector plan/);
  assert.match(r.stdout, /LoginBackendConnector/);
  assert.match(r.stdout, /bind helper: Android controls\.bindRepeater\("adapter-results", rows\)/);
});

test('fail-closed: missing project exits non-zero', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-connectors-plan.mjs', ['/no/such/project.json'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Project not found/);
});
