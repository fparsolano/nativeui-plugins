// mock-server.mjs — zero-dependency local mock backend for a NativeUI export.
//
// Serves canned JSON for the endpoints your app's CALL_API / CALL_DATABASE
// interactions hit, so you can do a real HTTP round-trip on localhost without
// writing a backend. Pure Node (18+), no npm install.
//
// Endpoint shape mirrors how NuiBackend resolves a target -> a request:
//   - CALL_API     -> NuiBackend.onCallApi(target, params)      -> GET/POST  /api/<target>
//   - CALL_DATABASE-> NuiBackend.onCallDatabase(target, params) -> POST      /db/<target>
// (Your NuiBackend builds the URL; this server just answers those paths.)
//
// Fixtures: edit fixtures.json next to this file to add/override responses,
// keyed by "<METHOD> <path>" (e.g. "GET /api/get_trips"). A "*" method matches
// any verb. Unknown paths get a generic { ok:true } so nothing 404s while you
// prototype. GET /health is always { status:"ok" }.
//
// Usage:
//   node mock-server.mjs                 # listens on 0.0.0.0:8787
//   PORT=4000 node mock-server.mjs       # custom port
//   node mock-server.mjs --port 4000     # or via flag

import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(HERE, 'fixtures.json');

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 8787;
}

// Built-in canned responses (used when fixtures.json is absent or has no match).
// Replace the keys with YOUR derived endpoints — one per CALL_API / CALL_DATABASE
// target. The values are whatever JSON your app expects to parse.
const BUILTIN = {
  'GET /api/get_trips': {
    trips: [
      { id: 'rome', title: 'Rome', nights: 4, price: 1280 },
      { id: 'lisbon', title: 'Lisbon', nights: 3, price: 740 },
    ],
  },
  'POST /api/login': { sessionId: 'mock-session-abc123', user: { id: 'u1', name: 'Dev User' } },
  'POST /db/save_note': { ok: true, id: 'note-1' },
};

async function loadFixtures() {
  try {
    const txt = await fs.readFile(FIXTURES_PATH, 'utf8');
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    console.error(`[mock] fixtures.json is not valid JSON: ${err.message}`);
    return {};
  }
}

// Resolve a response body for "<METHOD> <path>": fixtures win, then built-ins,
// then a wildcard "* <path>", then a generic ok so prototyping never blocks.
function resolveBody(fixtures, method, urlPath) {
  const exact = `${method} ${urlPath}`;
  const wild = `* ${urlPath}`;
  if (Object.prototype.hasOwnProperty.call(fixtures, exact)) return fixtures[exact];
  if (Object.prototype.hasOwnProperty.call(fixtures, wild)) return fixtures[wild];
  if (Object.prototype.hasOwnProperty.call(BUILTIN, exact)) return BUILTIN[exact];
  return { ok: true, path: urlPath, method, mock: true };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  let fixtures = await loadFixtures();

  const server = createServer((req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const urlPath = new URL(req.url, 'http://localhost').pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (urlPath === '/health') {
      send(res, 200, { status: 'ok' });
      return;
    }

    // Drain the request body (so POST bodies don't hang the socket); we echo it
    // back under `received` so you can confirm params reached the server.
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      const body = resolveBody(fixtures, method, urlPath);
      const received = raw ? safeJson(raw) : undefined;
      send(res, 200, received === undefined ? body : { ...wrap(body), received });
    });
  });

  server.listen(port, () => {
    console.log(`[mock] NativeUI mock backend on http://localhost:${port}`);
    console.log(`[mock] health: http://localhost:${port}/health`);
    console.log(
      Object.keys(fixtures).length
        ? `[mock] ${Object.keys(fixtures).length} fixture route(s) from ${FIXTURES_PATH}`
        : `[mock] no fixtures.json — using built-in routes (${Object.keys(BUILTIN).join(', ')})`
    );
  });

  // Hot-reload fixtures on change so you can edit responses without restarting.
  watchFixtures(async () => {
    fixtures = await loadFixtures();
  });
}

function wrap(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : { data: body };
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function watchFixtures(reload) {
  try {
    const watcher = fs.watch(FIXTURES_PATH);
    for await (const _ of watcher) {
      await reload();
      console.log('[mock] reloaded fixtures.json');
    }
  } catch {
    /* no fixtures file to watch — fine */
  }
}

main().catch((err) => {
  console.error(`[mock] failed to start: ${err.message}`);
  process.exit(1);
});
