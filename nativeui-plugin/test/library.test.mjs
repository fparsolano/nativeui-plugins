// library.test.mjs — API/database library item registration never writes secrets to project.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runBin, runBinAsync, unconfiguredEnv } from './helpers.mjs';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-library-'));
  const file = path.join(dir, 'project.json');
  fs.writeFileSync(file, JSON.stringify({ version: 4, stages: [{ name: 'Home', rootNodes: [] }], libraryItems: [] }, null, 2));
  return { dir, file };
}

function authedEnv(extra = {}) {
  const { env, home } = unconfiguredEnv();
  fs.mkdirSync(path.join(home, '.nativeui'), { recursive: true });
  fs.writeFileSync(path.join(home, '.nativeui/credentials.json'), JSON.stringify({
    idToken: 'test-token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 60 * 60 * 1000,
  }));
  return { env: { ...env, ...extra }, home };
}

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('upsert-api writes non-secret config only', () => {
  const { file } = tmpProject();
  const secret = 'sk-test-should-never-appear';
  const r = runBin('nui-library.mjs', [
    'upsert-api',
    file,
    '--name',
    'Login API',
    '--base-url',
    'https://api.example.com',
    '--path',
    '/login',
    '--method',
    'POST',
    '--auth-type',
    'bearer',
    '--api-key-name',
    'Authorization',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(secret));
  const project = JSON.parse(raw);
  const item = project.libraryItems[0];
  assert.equal(item.assetType, 'api');
  assert.equal(item.id, 'lib-api-login-api');
  const cfg = JSON.parse(item.configJson);
  assert.deepEqual(cfg, {
    baseUrl: 'https://api.example.com',
    path: '/login',
    method: 'POST',
    authType: 'bearer',
    apiKeyName: 'Authorization',
  });
});

test('upsert-database writes non-secret database config only', () => {
  const { file } = tmpProject();
  const r = runBin('nui-library.mjs', [
    'upsert-database',
    file,
    '--name',
    'Trips DB',
    '--connector',
    'postgresql',
    '--host',
    'db.example.com',
    '--port',
    '5432',
    '--database',
    'trips',
    '--username',
    'app_user',
    '--table',
    'trips',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  const item = project.libraryItems[0];
  assert.equal(item.assetType, 'database');
  assert.equal(item.id, 'lib-database-trips-db');
  assert.ok(!JSON.stringify(project).includes('password'));
  const cfg = JSON.parse(item.configJson);
  assert.equal(cfg.connectorId, 'postgresql');
  assert.equal(cfg.port, 5432);
});

test('put-secret requires stdin and sends the secret only to profile secret endpoint', async () => {
  let requestBody = '';
  const { server, url } = await serve((req, res) => {
    req.on('data', (chunk) => {
      requestBody += chunk;
    });
    req.on('end', () => {
      assert.equal(req.method, 'PUT');
      assert.equal(req.url, '/projects/p1/library/lib-api-login/secret');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'set', preview: 'sk-...1234' }));
    });
  });
  try {
    const secret = 'sk-real-secret-1234';
    const { env } = authedEnv({ NATIVEUI_PROFILE_API_URL: url });
    const r = await runBinAsync('nui-library.mjs', [
      'put-secret',
      '--project-id',
      'p1',
      '--item-id',
      'lib-api-login',
      '--kind',
      'api',
      '--secret-stdin',
    ], { env, input: secret });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(requestBody.includes(secret));
    assert.ok(!r.stdout.includes(secret));
  } finally {
    server.close();
  }
});
