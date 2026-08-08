// token.test.mjs — token refresh is brokered through NativeUI profile-api, not local Firebase keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { runBinAsync, unconfiguredEnv } from './helpers.mjs';

function authedExpiredEnv(profileUrl) {
  const { env, home } = unconfiguredEnv();
  fs.mkdirSync(path.join(home, '.nativeui'), { recursive: true });
  fs.writeFileSync(path.join(home, '.nativeui/credentials.json'), JSON.stringify({
    idToken: 'old-id-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() - 60 * 1000,
    email: 'old@example.com',
    uid: 'uid-old',
  }));
  return { env: { ...env, NATIVEUI_PROFILE_API_URL: profileUrl }, home };
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

test('token refresh uses profile-api session broker and updates cached session', async () => {
  let requestBody = '';
  const { server, url } = await serve((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/cli/session/refresh');
    req.on('data', (chunk) => {
      requestBody += chunk;
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        idToken: 'new-id-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        email: 'new@example.com',
        uid: 'uid-new',
      }));
    });
  });
  try {
    const { env, home } = authedExpiredEnv(url);
    const r = await runBinAsync('token.mjs', [], { env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'new-id-token');
    assert.deepEqual(JSON.parse(requestBody), { refreshToken: 'refresh-token' });
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.nativeui/credentials.json'), 'utf8'));
    assert.equal(saved.idToken, 'new-id-token');
    assert.equal(saved.refreshToken, 'new-refresh-token');
    assert.equal(saved.email, 'new@example.com');
  } finally {
    server.close();
  }
});
