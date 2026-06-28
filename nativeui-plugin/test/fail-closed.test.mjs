// fail-closed.test.mjs — every command FAILS CLOSED (exit non-zero) on missing
// config/auth or bad args, WITHOUT reaching the network.
//
// Each network command needs auth (getFreshToken) before its service fetch. With
// HOME pointed at an empty dir and every NATIVEUI_* unset, getFreshToken throws
// before the command-specific network call. We also assert bad-args guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBin, fixture, unconfiguredEnv } from './helpers.mjs';

// Commands that require auth to do anything. Given valid-enough args but no cached
// session, each must exit non-zero before any command-specific network call.
const NETWORK_COMMANDS = [
  { name: 'preflight.mjs', args: [] },
  { name: 'token.mjs', args: [] },
  { name: 'nui-import.mjs', args: [fixture('good-project.json')] }, // any file; config guard fires first
  { name: 'nui-export.mjs', args: [fixture('good-project.json'), '--platform', 'android', '-o', '/tmp/nui-test-out'] },
  { name: 'nui-save.mjs', args: [fixture('good-project.json'), '--name', 'X'] },
  { name: 'nui-preview.mjs', args: [fixture('good-project.json'), '--name', 'X'] },
  { name: 'nui-validate.mjs', args: [fixture('good-project.json')] }, // no --structural -> needs model round-trip
  { name: 'nui-fragment-extract.mjs', args: [fixture('good-project.json'), '--id', 'screen'] },
  { name: 'nui-fragment-import.mjs', args: [fixture('good-project.json')] }, // any file
  { name: 'nui-report-parity.mjs', args: ['--title', 'x'] },
  { name: 'nui-project-sync.mjs', args: ['status', fixture('good-project.json'), '--name', 'X'] },
  { name: 'nui-library.mjs', args: ['put-secret', '--project-id', 'p1', '--item-id', 'lib-api', '--kind', 'api', '--secret-stdin'] },
];

for (const cmd of NETWORK_COMMANDS) {
  test(`fail-closed: ${cmd.name} exits non-zero with no config/auth (no network)`, () => {
    const { env } = unconfiguredEnv();
    const r = runBin(cmd.name, cmd.args, { env });
    assert.notEqual(r.status, 0, `${cmd.name} should fail closed; stdout=${r.stdout}`);
    // The failure must be the auth/config/bugs-url guard — NOT a network/parse crash.
    assert.match(
      r.stderr,
      /not configured|Not logged in|Missing|NATIVEUI_|configure|log in/i,
      `${cmd.name} should report a config/auth guard, got: ${r.stderr}`
    );
  });
}

// ── Bad-args guards (these run BEFORE config, so they fail closed even if configured) ──

const BAD_ARGS = [
  { name: 'nui-import.mjs', args: [], match: /No HTML files given/ },
  { name: 'nui-export.mjs', args: [fixture('good-project.json')], match: /Missing --platform/ },
  { name: 'nui-export.mjs', args: [fixture('good-project.json'), '--platform', 'web', '-o', '/tmp/x'], match: /must be 'android' or 'ios'/ },
  { name: 'nui-export.mjs', args: [fixture('good-project.json'), '--platform', 'android', '-o', '/tmp/x', '--mode', 'wat'], match: /must be 'beta' or 'prod'/ },
  { name: 'nui-save.mjs', args: [fixture('good-project.json')], match: /name is required/i },
  { name: 'nui-save.mjs', args: [], match: /No project file given/ },
  { name: 'nui-preview.mjs', args: [fixture('good-project.json')], match: /name is required/i },
  { name: 'nui-preview.mjs', args: ['--bogus'], match: /Unknown flag/ },
  { name: 'nui-fragment-extract.mjs', args: [fixture('good-project.json')], match: /Missing --id/ },
  { name: 'nui-fragment-extract.mjs', args: [], match: /Missing <project.json>/ },
  { name: 'nui-fragment-import.mjs', args: [], match: /Missing <snippet.html>/ },
  { name: 'nui-report-parity.mjs', args: ['--nope'], match: /Unknown flag/ },
  { name: 'nui-run.mjs', args: [], match: /Provide a <project.json>/ },
  { name: 'nui-run.mjs', args: [fixture('good-project.json'), '--platform', 'desktop'], match: /must be android\|ios\|both/ },
  { name: 'nui-intake.mjs', args: [], match: /No inputs/ },
  { name: 'nui-responsive-audit.mjs', args: [], match: /No inputs/ },
  { name: 'nui-design-guide.mjs', args: [], match: /Usage/ },
  { name: 'nui-design-guide.mjs', args: ['init'], match: /Missing -o/ },
  { name: 'nui-design-guide.mjs', args: ['check'], match: /Missing design guide path/ },
  { name: 'nui-architecture.mjs', args: [], match: /Usage/ },
  { name: 'nui-architecture.mjs', args: ['init'], match: /Missing -o/ },
  { name: 'nui-architecture.mjs', args: ['check'], match: /Missing architecture file path/ },
  { name: 'nui-connectors-plan.mjs', args: ['--bogus'], match: /Unknown flag/ },
  { name: 'nui-final-review.mjs', args: [], match: /Provide --project/ },
  { name: 'nui-project-sync.mjs', args: [], match: /Usage/ },
  { name: 'nui-project-sync.mjs', args: ['status'], match: /Missing <project\.json>/ },
  { name: 'nui-project-sync.mjs', args: ['status', fixture('good-project.json')], match: /Provide --project-id or --name/ },
  { name: 'nui-library.mjs', args: [], match: /Usage/ },
  { name: 'nui-library.mjs', args: ['upsert-api', fixture('good-project.json')], match: /requires --name/ },
  { name: 'nui-library.mjs', args: ['put-secret', '--project-id', 'p1', '--item-id', 'x', '--kind', 'api'], match: /--secret-stdin/ },
  { name: 'login.mjs', args: ['--password'], match: /Password login has been removed/ },
];

for (const c of BAD_ARGS) {
  test(`bad-args: ${c.name} ${c.args.join(' ') || '(no args)'} -> exit 1, message`, () => {
    const { env } = unconfiguredEnv();
    const r = runBin(c.name, c.args, { env });
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}; stderr=${r.stderr}`);
    assert.match(r.stderr, c.match);
  });
}

// nui-preview --no-save must fail closed (no live preview without a save), and its
// message must point at re-running without --no-save (it never reaches the network for
// this branch, since it short-circuits before getFreshToken).
test('nui-preview --no-save fails closed with a clear note', () => {
  const { env } = unconfiguredEnv();
  // --no-save short-circuits after getConfig; provide host env so this branch stays
  // explicit even if defaults change later.
  const cfgEnv = {
    ...env,
    NATIVEUI_EXPORT_SERVICE_URL: 'https://dev.nativeui.com',
    NATIVEUI_BILLING_API_URL: 'https://dev.nativeui.com/api/billing',
  };
  const r = runBin('nui-preview.mjs', [fixture('good-project.json'), '--no-save'], { env: cfgEnv });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Local check only|NOT uploaded/);
  assert.match(r.stderr, /webapp\.dev\.nativeui\.com/); // derived editor URL surfaced
});
