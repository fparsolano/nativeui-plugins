// connectors-plan-rust.test.mjs — nui-connectors-plan must expose the first-class Rust targets' single
// app_actions.rs hook plan (additive `rust` field in JSON; a focused --platform rust human view), derived
// from the same backend needs as the mobile connector plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runBin } from './helpers.mjs';

const PROJECT = fixture('backend-plan.project.json');

test('--json plan carries an additive rust hook plan (single seam)', () => {
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.ok(plan.rust, 'plan.rust present');
  assert.equal(plan.rust.seamFile, 'src/app_actions.rs');
  assert.equal(plan.rust.trait, 'nui_rt::actions::NuiBackend');
  assert.equal(plan.rust.implType, 'AppActions');
  const hooks = plan.rust.hooks.map((h) => h.hook);
  // The fixture authors CALL_API, CALL_DATABASE, SUBMIT_FORM, and an api-backed repeater.
  for (const h of ['on_call_api', 'on_call_database', 'on_submit_form', 'fetch_list']) {
    assert.ok(hooks.includes(h), `expected hook ${h}, got: ${hooks.join(',')}`);
  }
  // Each hook lists its concrete targets.
  const callApi = plan.rust.hooks.find((h) => h.hook === 'on_call_api');
  assert.ok(callApi.targets.length > 0, 'on_call_api lists targets');
});

test('--platform rust --human prints the app_actions.rs hook plan, not the connector-twin plan', () => {
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--platform', 'rust', '--human']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Rust backend plan/);
  assert.match(r.stdout, /src\/app_actions\.rs/);
  assert.match(r.stdout, /Implement these NuiBackend hooks/);
  assert.match(r.stdout, /on_submit_form/);
  assert.match(r.stdout, /docs\/rust-backend-contract\.md/);
  // Must NOT fall into the mobile connector-twin view.
  assert.doesNotMatch(r.stdout, /BackendConnector/);
});

test('--platform web resolves the backward-compatible vanilla web seam', () => {
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--platform', 'web', '--human']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Web backend plan/);
  assert.match(r.stdout, /app-actions\.js/);
  assert.match(r.stdout, /data-adapters\.js/);
});

test('default (mobile) human view is unchanged — still the connector-twin plan', () => {
  const r = runBin('nui-connectors-plan.mjs', [PROJECT, '--human']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NativeUI connector plan/);
  assert.match(r.stdout, /BackendConnector/);
});
