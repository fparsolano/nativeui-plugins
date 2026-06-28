// export-auth-mode.test.mjs — hosted NativeUI auth vs export-only fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fixture, runBinAsync, unconfiguredEnv } from './helpers.mjs';

async function withServer(handler, fn) {
  const calls = [];
  const server = http.createServer((req, res) => handler(req, res, calls));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tempHomeWithCreds() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-auth-home-'));
  fs.mkdirSync(path.join(home, '.nativeui'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.nativeui', 'credentials.json'),
    JSON.stringify({
      idToken: 'id-token-hosted',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: 'hosted@example.com',
      uid: 'u1',
    }),
  );
  return home;
}

function envFor(baseUrl, { mode = 'nativeui', withCreds = true } = {}) {
  const home = withCreds ? tempHomeWithCreds() : fs.mkdtempSync(path.join(os.tmpdir(), 'nui-auth-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (k.startsWith('NATIVEUI_')) delete env[k];
  env.NATIVEUI_EXPORT_SERVICE_URL = baseUrl;
  env.NATIVEUI_BILLING_API_URL = mode === 'none' ? '' : `${baseUrl}/api/billing`;
  env.NATIVEUI_EXPORT_AUTH_MODE = mode;
  return env;
}

function writeTempHtml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-html-'));
  const file = path.join(dir, 'home.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1>Hello</h1></body></html>');
  return file;
}

test('nui-import sends Authorization in hosted mode and omits it in export-only mode', async () => {
  await withServer((req, res, calls) => {
    calls.push({ url: req.url, authorization: req.headers.authorization || '' });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ project: { version: 4, stages: [] } }));
  }, async (baseUrl, calls) => {
    const hostedOut = path.join(os.tmpdir(), `nui-import-hosted-${process.pid}.json`);
    const hosted = await runBinAsync('nui-import.mjs', [writeTempHtml(), '-o', hostedOut], {
      env: envFor(baseUrl, { mode: 'nativeui', withCreds: true }),
    });
    assert.equal(hosted.status, 0, hosted.stderr);
    assert.equal(calls.at(-1).authorization, 'Bearer id-token-hosted');

    const exportOnlyOut = path.join(os.tmpdir(), `nui-import-none-${process.pid}.json`);
    const exportOnly = await runBinAsync('nui-import.mjs', [writeTempHtml(), '-o', exportOnlyOut], {
      env: envFor(baseUrl, { mode: 'none', withCreds: false }),
    });
    assert.equal(exportOnly.status, 0, exportOnly.stderr);
    assert.equal(calls.at(-1).authorization, '');
  });
});

test('nui-export sends Authorization in hosted mode and omits it in export-only mode', async () => {
  await withServer((req, res, calls) => {
    calls.push({ url: req.url, authorization: req.headers.authorization || '' });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ files: [] }));
  }, async (baseUrl, calls) => {
    const hostedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-export-hosted-'));
    const hosted = await runBinAsync(
      'nui-export.mjs',
      [fixture('good-project.json'), '--platform', 'android', '--manifest', '-o', hostedDir],
      { env: envFor(baseUrl, { mode: 'nativeui', withCreds: true }) },
    );
    assert.equal(hosted.status, 0, hosted.stderr);
    assert.equal(calls.at(-1).authorization, 'Bearer id-token-hosted');

    const exportOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-export-none-'));
    const exportOnly = await runBinAsync(
      'nui-export.mjs',
      [fixture('good-project.json'), '--platform', 'android', '--manifest', '-o', exportOnlyDir],
      { env: envFor(baseUrl, { mode: 'none', withCreds: false }) },
    );
    assert.equal(exportOnly.status, 0, exportOnly.stderr);
    assert.equal(calls.at(-1).authorization, '');
  });
});

test('account-backed commands fail clearly in export-only mode', async () => {
  const { env } = unconfiguredEnv();
  env.NATIVEUI_EXPORT_SERVICE_URL = 'https://nativeui-export.internal.example.com';
  env.NATIVEUI_EXPORT_AUTH_MODE = 'none';
  env.NATIVEUI_BILLING_API_URL = '';

  const commands = [
    { name: 'nui-save.mjs', args: [fixture('good-project.json'), '--name', 'X'] },
    { name: 'nui-preview.mjs', args: [fixture('good-project.json'), '--name', 'X'] },
    { name: 'nui-project-sync.mjs', args: ['status', fixture('good-project.json'), '--name', 'X'] },
    {
      name: 'nui-library.mjs',
      args: ['put-secret', '--project-id', 'p1', '--item-id', 'lib-api', '--kind', 'api', '--secret-stdin'],
    },
    { name: 'nui-report-parity.mjs', args: ['--title', 'x'] },
  ];

  for (const command of commands) {
    const r = await runBinAsync(command.name, command.args, { env, input: 'secret\n' });
    assert.equal(r.status, 1, `${command.name} should fail; stdout=${r.stdout}`);
    assert.match(r.stderr, /not available in export-only mode/);
  }
});
