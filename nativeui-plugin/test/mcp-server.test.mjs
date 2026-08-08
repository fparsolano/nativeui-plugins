import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

function startServer(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp/server.mjs')], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffered = '';
  const pending = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    let index;
    while ((index = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
      const next = pending.shift();
      if (next) next.resolve(JSON.parse(line));
    }
  });
  return {
    child,
    request(payload) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(`${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n`);
      });
    },
    async close() { child.stdin.end(); await new Promise((resolve) => child.once('close', resolve)); },
  };
}

test('MCP stdio server lists tools, survives malformed input, and imports through the shared service client', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-mcp-home-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-mcp-work-'));
  const html = path.join(work, 'page.html');
  const output = path.join(work, 'project.json');
  fs.writeFileSync(html, '<main>Hello</main>');
  const { server, url } = await serve((req, res) => {
    assert.equal(req.url, '/export/import/html');
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      assert.equal(JSON.parse(body).pages[0].name, 'page');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ project: { version: 4, stages: [{ rootNodes: [{ id: 'root', kind: 'javafx.scene.layout.Pane' }] }] } }));
    });
  });
  const mcp = startServer({ HOME: home, USERPROFILE: home, NATIVEUI_EXPORT_SERVICE_URL: url, NATIVEUI_EXPORT_AUTH_MODE: 'none' });
  try {
    const init = await mcp.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    assert.equal(init.result.serverInfo.name, 'nativeui');
    const listed = await mcp.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(listed.result.tools.length, 22, 'every hosted NativeUI verb should be exposed');
    assert.ok(listed.result.tools.some((tool) => tool.name === 'nativeui_import_html'));
    assert.ok(listed.result.tools.some((tool) => tool.name === 'nativeui_screen_update'));
    const malformed = await mcp.request('{');
    assert.equal(malformed.error.code, -32700);
    const status = await mcp.request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nativeui_auth_status', arguments: {} } });
    assert.equal(JSON.parse(status.result.content[0].text).loggedIn, false);
    assert.equal(JSON.parse(status.result.content[0].text).authenticated, true);
    const imported = await mcp.request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nativeui_import_html', arguments: { htmlFiles: [html], outPath: output } } });
    assert.equal(JSON.parse(imported.result.content[0].text).outPath, output);
    assert.ok(fs.existsSync(output));
  } finally {
    await mcp.close();
    server.close();
  }
});

test('MCP permits only approved export-only operations without a NativeUI session', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-mcp-export-only-'));
  const mcp = startServer({ HOME: home, USERPROFILE: home, NATIVEUI_EXPORT_AUTH_MODE: 'none' });
  try {
    const response = await mcp.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nativeui_save_project', arguments: { projectPath: '/tmp/project.json', name: 'Example' } } });
    assert.equal(response.result.isError, true);
    assert.equal(JSON.parse(response.result.content[0].text).error.code, 'EXPORT_ONLY_MODE');
  } finally {
    await mcp.close();
  }
});

test('MCP starts and reuses a browser login flow before running an unauthenticated protected tool', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-mcp-empty-'));
  let deviceCodeRequests = 0;
  const { server, url } = await serve((req, res) => {
    assert.equal(req.url, '/api/profile/cli/device/code');
    deviceCodeRequests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deviceCode: 'device-code-1', userCode: 'ABCD-EFGH', verificationUri: `${url}/device`, interval: 2, expiresIn: 900 }));
  });
  const mcp = startServer({ HOME: home, USERPROFILE: home, NATIVEUI_EXPORT_SERVICE_URL: url });
  try {
    const response = await mcp.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nativeui_preflight', arguments: {} } });
    assert.equal(response.result.isError, true);
    const firstError = JSON.parse(response.result.content[0].text).error;
    assert.equal(firstError.code, 'NOT_LOGGED_IN');
    assert.equal(firstError.login.fullUri, `${url}/device?userCode=ABCD-EFGH`);
    assert.equal(firstError.login.userCode, 'ABCD-EFGH');
    assert.equal(firstError.login.nextTool, 'nativeui_login_wait');
    const retry = await mcp.request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nativeui_preflight', arguments: {} } });
    assert.equal(JSON.parse(retry.result.content[0].text).error.login.deviceCode, 'device-code-1');
    assert.equal(deviceCodeRequests, 1, 'protected retries should reuse the pending browser-login session');
  } finally {
    await mcp.close();
    server.close();
  }
});
