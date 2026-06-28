// agent-artifacts.test.mjs - deterministic design/architecture artifacts for agents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nui-agent-artifacts-'));
}

test('nui-design-guide scaffolds and checks the design guide contract', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'nativeui-design-guide.md');
  const { env } = unconfiguredEnv();
  const init = runBin('nui-design-guide.mjs', ['init', '-o', out, '--prompt', 'Trips app'], { env });
  assert.equal(init.status, 0, init.stderr);
  assert.ok(fs.existsSync(out));
  const check = runBin('nui-design-guide.mjs', ['check', out], { env });
  assert.equal(check.status, 0, check.stderr);
});

test('nui-architecture requires approval when asked', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'nativeui-architecture.md');
  const { env } = unconfiguredEnv();
  const init = runBin('nui-architecture.mjs', ['init', '-o', out, '--project', path.join(dir, 'project.json')], { env });
  assert.equal(init.status, 0, init.stderr);
  const unapproved = runBin('nui-architecture.mjs', ['check', out, '--require-approved'], { env });
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stderr, /not approved/i);

  const text = fs.readFileSync(out, 'utf8').replace('- [ ] User approved this architecture for implementation.', '- [x] User approved this architecture for implementation.');
  fs.writeFileSync(out, text);
  const approved = runBin('nui-architecture.mjs', ['check', out, '--require-approved'], { env });
  assert.equal(approved.status, 0, approved.stderr);
});
