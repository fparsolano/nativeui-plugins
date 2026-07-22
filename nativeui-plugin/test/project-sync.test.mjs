// project-sync.test.mjs — guarded project sync detects stale cloud edits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runBinAsync, unconfiguredEnv } from './helpers.mjs';
import { hashText, summarizeStatus } from '../bin/nui-project-sync.mjs';

function projectFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-sync-'));
  const file = path.join(dir, 'project.json');
  fs.writeFileSync(file, JSON.stringify({ version: 4, stages: [{ name: 'Home', rootNodes: [] }] }, null, 2));
  return { dir, file };
}

function authedEnv(profileUrl) {
  const { env, home } = unconfiguredEnv();
  fs.mkdirSync(path.join(home, '.nativeui'), { recursive: true });
  fs.writeFileSync(path.join(home, '.nativeui/credentials.json'), JSON.stringify({
    idToken: 'test-token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 60 * 60 * 1000,
  }));
  return { ...env, NATIVEUI_PROFILE_API_URL: profileUrl };
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

test('summarizeStatus marks local+cloud divergence as a conflict', () => {
  const localText = '{"version":4,"local":true}';
  const cloudText = '{"version":4,"cloud":true}';
  const report = summarizeStatus({
    localText,
    meta: { revision: 1, contentHash: hashText('{"version":4}') },
    cloudRow: { id: 'p1', name: 'App', revision: 2 },
    cloudContent: { revision: 2, contentJson: cloudText },
  });
  assert.equal(report.localChanged, true);
  assert.equal(report.cloudChanged, true);
  assert.equal(report.conflict, true);
});

test('status exits 2 when cloud and local both changed', async () => {
  const { file } = projectFile();
  fs.writeFileSync(`${file}.nativeui-sync.json`, JSON.stringify({
    version: 1,
    projectId: 'p1',
    name: 'App',
    revision: 1,
    contentHash: hashText('{"version":4}'),
  }));
  const { server, url } = await serve((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/projects') {
      res.end(JSON.stringify({ items: [{ id: 'p1', name: 'App', revision: 2 }] }));
    } else if (req.url === '/projects/p1/content') {
      res.end(JSON.stringify({ contentJson: '{"version":4,"cloud":true}', revision: 2 }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
  try {
    const r = await runBinAsync('nui-project-sync.mjs', ['status', file, '--name', 'App'], {
      env: authedEnv(url),
    });
    assert.equal(r.status, 2, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.conflict, true);
  } finally {
    server.close();
  }
});

test('push sends expectedRevision and exits 2 on profile 409', async () => {
  const { file } = projectFile();
  fs.writeFileSync(`${file}.nativeui-sync.json`, JSON.stringify({
    version: 1,
    projectId: 'p1',
    name: 'App',
    revision: 1,
    contentHash: hashText('{"version":4}'),
  }));
  let sawExpectedRevision = false;
  const { server, url } = await serve((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/projects') {
      res.end(JSON.stringify({ items: [{ id: 'p1', name: 'App', revision: 2 }] }));
      return;
    }
    if (req.method === 'PUT' && req.url === '/projects/p1/content') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        sawExpectedRevision = JSON.parse(body).expectedRevision === 1;
        res.statusCode = 409;
        res.end(JSON.stringify({ error: 'Project changed', code: 'revision_mismatch', revision: 2 }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  try {
    const r = await runBinAsync('nui-project-sync.mjs', ['push', file, '--name', 'App'], {
      env: authedEnv(url),
    });
    assert.equal(r.status, 2);
    assert.equal(sawExpectedRevision, true);
    assert.match(r.stderr, /changed since last sync/i);
  } finally {
    server.close();
  }
});
