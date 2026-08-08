import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function temp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-flow-'));
  return path.join(dir, name);
}

test('responsive but interaction-free HTML fails the dynamic-flow gate', () => {
  const file = temp('interaction-free.html');
  fs.writeFileSync(file, '<style>.screen{display:grid;width:100%;min-width:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}</style><main class="screen">Hello</main>');
  const { env } = unconfiguredEnv();
  const result = runBin('nui-flow-audit.mjs', [file], { env });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).inputs[0].issues[0].code, 'flow.interactions-missing');
});

test('interactive form HTML passes when error and success feedback are designed', () => {
  const file = temp('form.html');
  fs.writeFileSync(file, '<form><input id="email"><button id="submit">Save</button></form><p id="validation_error">Error</p><p id="save_success">Success</p>');
  const { env } = unconfiguredEnv();
  const result = runBin('nui-flow-audit.mjs', [file], { env });
  assert.equal(result.status, 0, result.stderr);
});

test('portable data-nui-on-tap actions are recognized and are not dead buttons', () => {
  const file = temp('tap.html');
  fs.writeFileSync(file, '<button id="toggle" data-nui-on-tap="toggle:#details">Details</button><section id="details">Selected details</section>');
  const { env } = unconfiguredEnv();
  const result = runBin('nui-flow-audit.mjs', [file], { env });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout).inputs[0];
  assert.equal(report.portableActions, 1);
  assert.deepEqual(report.deadButtons, []);
});

test('project flow requires interactions and relevant async states', () => {
  const file = temp('project.json');
  fs.writeFileSync(file, JSON.stringify({ version: 4, stages: [{ name: 'Home', rootNodes: [{ id: 'root', kind: 'javafx.scene.layout.VBox' }] }] }));
  const { env } = unconfiguredEnv();
  const missing = runBin('nui-flow-audit.mjs', [file], { env });
  assert.equal(missing.status, 1);

  fs.writeFileSync(file, JSON.stringify({ version: 4, stages: [{ name: 'Home', rootNodes: [{
    id: 'root', kind: 'javafx.scene.layout.VBox',
    children: [{ id: 'loading_state', kind: 'javafx.scene.control.Label' }, { id: 'error_state', kind: 'javafx.scene.control.Label' }],
    interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'api' }],
  }] }] }));
  const passing = runBin('nui-flow-audit.mjs', [file], { env });
  assert.equal(passing.status, 0, passing.stderr);
});
