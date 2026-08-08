// backend-plan.test.mjs — nui-backend-plan.mjs derives the backend surface from a
// project.json, detects the local toolchain, recommends a stack, and FAILS CLOSED on
// a missing/invalid project. Pure Node (node:test), no token/network needed — the tool
// is local + auth-free by design (the account gate lives in the skill preflight, not here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBin, fixture, unconfiguredEnv } from './helpers.mjs';

const PROJECT = fixture('backend-plan.project.json');

function planJson(env) {
  const r = runBin('nui-backend-plan.mjs', [PROJECT, '--json'], { env });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('derives endpoints: GET /api/profile (CALL_API via library configJson) + POST /auth/login (SUBMIT_FORM)', () => {
  const { env } = unconfiguredEnv(); // no config needed — the tool runs anywhere
  const plan = planJson(env);

  const eps = plan.needs.endpoints;
  const profile = eps.find((e) => e.method === 'GET' && e.path === '/api/profile');
  assert.ok(profile, `expected GET /api/profile, got ${JSON.stringify(eps)}`);
  assert.match(profile.source, /libraryItems api/);

  const login = eps.find((e) => e.method === 'POST' && e.path === '/auth/login');
  assert.ok(login, `expected POST /auth/login, got ${JSON.stringify(eps)}`);
  assert.match(login.source, /SUBMIT_FORM/);

  const repeater = eps.find((e) => e.method === 'GET' && e.path === '/api/results');
  assert.ok(repeater, `expected GET /api/results for repeater adapter, got ${JSON.stringify(eps)}`);
  assert.match(repeater.source, /repeater/);
});

test('derives a database query op on the posts table (CALL_DATABASE via library configJson)', () => {
  const { env } = unconfiguredEnv();
  const plan = planJson(env);

  const dbs = plan.needs.databases;
  const feed = dbs.find((d) => d.op === 'query' && d.collection === 'posts');
  assert.ok(feed, `expected a query on posts, got ${JSON.stringify(dbs)}`);
  assert.match(feed.source, /libraryItems database/);
});

test('reports repeater data sources and library registration', () => {
  const { env } = unconfiguredEnv();
  const plan = planJson(env);
  const repeaters = plan.needs.repeaters;
  const results = repeaters.find((r) => r.nodeId === 'results_list');
  assert.ok(results, `expected results_list repeater, got ${JSON.stringify(repeaters)}`);
  assert.equal(results.adapterId, 'adapter-results');
  assert.equal(results.dataSource, 'lib-api-results');
  assert.equal(results.libraryItemId, 'lib-api-results');
  assert.equal(results.assetType, 'api');
  assert.equal(results.sampleItems, 2);
});

test('detects auth need (PasswordField + auth-shaped form action)', () => {
  const { env } = unconfiguredEnv();
  const plan = planJson(env);
  assert.equal(plan.needs.auth.needed, true);
  assert.ok(plan.needs.auth.reasons.length >= 1, 'expected at least one auth reason');
});

test('detects the local toolchain (node is present on the test machine)', () => {
  const { env } = unconfiguredEnv();
  const plan = planJson(env);
  assert.ok(plan.detected && plan.detected.runtimes, 'expected detected.runtimes');
  assert.equal(plan.detected.runtimes.node.present, true, 'node must be detected (we run on node)');
  // every probed entry is shaped {present, version} and never threw:
  for (const group of ['runtimes', 'deploy']) {
    for (const [name, v] of Object.entries(plan.detected[group])) {
      assert.equal(typeof v.present, 'boolean', `${group}.${name}.present must be boolean`);
    }
  }
});

test('recommends a stack + deploy target with a reason', () => {
  const { env } = unconfiguredEnv();
  const plan = planJson(env);
  const r = plan.recommended;
  assert.ok(r, 'expected a recommendation');
  assert.match(
    r.stack,
    /^(node-hono|python-fastapi|go-nethttp|supabase|mock-local)$/,
    `unexpected stack: ${r.stack}`
  );
  assert.match(
    r.deployTarget,
    /^(cloud-run|fly|railway|vercel|netlify|supabase|docker-vps)$/,
    `unexpected deployTarget: ${r.deployTarget}`
  );
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'expected a non-empty reason');
});

test('--human renders a readable plan (exit 0)', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-backend-plan.mjs', [PROJECT, '--human'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NativeUI backend plan/);
  assert.match(r.stdout, /Recommended stack:/);
});

test('fail-closed: missing project file -> exit 1, nothing on stdout', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-backend-plan.mjs', ['/no/such/project.json'], { env });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not found/);
});

test('fail-closed: invalid JSON -> exit 1', () => {
  const { env } = unconfiguredEnv();
  // package.json is valid JSON but not a ProjectState; use a clearly non-JSON file.
  const r = runBin('nui-backend-plan.mjs', [fixture('not-json.txt'), '--json'], { env });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not valid JSON/);
});

test('fail-closed: a JSON object with no stages[] -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-backend-plan.mjs', [fixture('no-stages.json'), '--json'], { env });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no stages/);
});

test('fail-closed: unknown flag -> exit 1', () => {
  const { env } = unconfiguredEnv();
  const r = runBin('nui-backend-plan.mjs', [PROJECT, '--bogus'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown flag/);
});
