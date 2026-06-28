// nui-backend-plan.mjs — derive the BACKEND SERVER your exported app talks to.
//
// The nativeui-connect skill wires the ON-DEVICE half (NuiBackend.{kt,swift} against
// the generated NuiScreenControls/NuiScreenDelegate contract). This tool plans the
// OTHER half: the HTTP server those CALL_API / CALL_DATABASE / SUBMIT_FORM actions
// reach. It reads a project.json, DERIVES the concrete backend surface that the
// authored interactions imply, DETECTS the local toolchain, and RECOMMENDS a stack +
// deploy target — so the nativeui-backend skill can scaffold a server that actually
// matches the app.
//
// What it derives (purely from the model — see references/backend-contract.md):
//   - endpoints[]   from CALL_API actions + form SUBMIT_FORM actions, resolved against
//                   libraryItems[] (assetType "api", configJson) when a target points
//                   at one. Each is {method, path, name, payloadHint, source, target}.
//   - databases[]   from CALL_DATABASE actions, resolved against libraryItems[]
//                   (assetType "database", configJson). Each is {op, name, target, source}.
//   - repeaters[]   from nodes with repeater.enabled; a dataSource that resolves to an
//                   api/database library item contributes the same endpoint/database need.
//   - auth          { needed, reasons[] } from login/password forms + auth-shaped fields.
//
// What it detects (probe '<tool> --version', presence + first version line, never throws):
//   runtimes: node npm pnpm yarn bun · python3 pip poetry uv · go · cargo · java mvn
//   deploy CLIs: gcloud flyctl vercel netlify supabase railway wrangler · docker
//
// What it recommends: a stack gated by what's installed + endpoint complexity, and a
// deploy target (gcloud -> Cloud Run is the default when present).
//
// Output: a JSON plan (default, or --json):
//   { needs:{endpoints,databases,auth}, detected:{...}, recommended:{stack,deployTarget,reason} }
// Pass --human for a readable summary instead.
//
// Usage:
//   node bin/nui-backend-plan.mjs [project.json] [--json|--human]
//
// Pure Node (Node 18+), no deps, NO network, NO auth. Fails closed (exit 1) on a
// missing/invalid project.json — BEFORE probing the toolchain. The plan is advisory;
// it never edits the project or any file.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

class BackendPlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackendPlanError';
  }
}

const USAGE = 'Usage: node bin/nui-backend-plan.mjs [project.json] [--json|--human]';

function parseArgs(argv) {
  let project;
  let format = 'json';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      format = 'json';
    } else if (a === '--human') {
      format = 'human';
    } else if (a === '-h' || a === '--help') {
      throw new BackendPlanError(USAGE);
    } else if (a.startsWith('-')) {
      throw new BackendPlanError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project) {
      project = a;
    } else {
      throw new BackendPlanError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!project) project = './project.json';
  return { project, format };
}

// ── Model walk ──────────────────────────────────────────────────────────────
// Visit every node across every stage (recursing children + graphic/clip slots),
// invoking fn(node). Mirrors the traversal in nui-fragment-extract.mjs.
function walkNodes(project, fn) {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    fn(n);
    if (Array.isArray(n.children)) n.children.forEach(visit);
    if (n.graphicNode) visit(n.graphicNode);
    if (n.clipNode) visit(n.clipNode);
  };
  for (const st of Array.isArray(project.stages) ? project.stages : []) {
    for (const root of Array.isArray(st.rootNodes) ? st.rootNodes : []) visit(root);
  }
}

// Collect EVERY interaction in the project, tagged with where it came from. Both
// stage-scoped (stages[].interactions[]) and node-scoped (node.interactions[]).
// InteractionState = {trigger, action, targetStageId, targetNodeId, targetLibraryItemId, params}.
function collectInteractions(project) {
  const out = [];
  for (const st of Array.isArray(project.stages) ? project.stages : []) {
    const stageName = typeof st.name === 'string' ? st.name : st.stageId || 'stage';
    for (const ix of Array.isArray(st.interactions) ? st.interactions : []) {
      if (ix && typeof ix === 'object') out.push({ ix, where: `stage "${stageName}"`, nodeId: null });
    }
  }
  walkNodes(project, (n) => {
    for (const ix of Array.isArray(n.interactions) ? n.interactions : []) {
      if (ix && typeof ix === 'object') {
        out.push({ ix, where: `node "${n.id || n.kind || '?'}"`, nodeId: n.id || null });
      }
    }
  });
  return out;
}

// Index libraryItems by id for api/database resolution. configJson is a serialized
// JSON string (LibraryItemState.configJson); parse it leniently.
function indexLibraryItems(project) {
  const byId = new Map();
  for (const it of Array.isArray(project.libraryItems) ? project.libraryItems : []) {
    if (it && typeof it === 'object' && typeof it.id === 'string') byId.set(it.id, it);
  }
  return byId;
}

function parseConfigJson(item) {
  if (!item || typeof item.configJson !== 'string' || !item.configJson.trim()) return {};
  try {
    const c = JSON.parse(item.configJson);
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

// Resolve an interaction's target to a libraryItems entry, preferring the explicit
// targetLibraryItemId, then any id-shaped target that hits the library index.
function resolveTargetItem(ix, libById) {
  const candidates = [ix.targetLibraryItemId, ix.targetNodeId, ix.targetStageId];
  for (const c of candidates) {
    if (typeof c === 'string' && libById.has(c)) return libById.get(c);
  }
  return null;
}

function dataSourceCandidates(item) {
  const values = [item?.id, item?.name];
  const cfg = parseConfigJson(item);
  values.push(cfg.path, cfg.url, cfg.endpoint, cfg.table, cfg.collection, cfg.name);
  return values.filter(Boolean).map((v) => String(v).trim().toLowerCase());
}

function resolveDataSourceItem(dataSource, libById) {
  const raw = String(dataSource || '').trim().toLowerCase();
  if (!raw) return null;
  if (libById.has(dataSource)) return libById.get(dataSource);
  const short = raw.replace(/^(api|db|database)\./, '');
  for (const item of libById.values()) {
    if (!['api', 'database'].includes(String(item.assetType || '').toLowerCase())) continue;
    if (dataSourceCandidates(item).some((v) => v === raw || v === short || v.endsWith(`/${short}`))) {
      return item;
    }
  }
  return null;
}

function indexDataAdapters(project) {
  const out = new Map();
  for (const adapter of Array.isArray(project?.dataAdapters) ? project.dataAdapters : []) {
    if (adapter?.id) out.set(String(adapter.id), adapter);
  }
  return out;
}

function repeaterSource(repeater, adapters, libById) {
  const adapterId = String(repeater?.adapterId || '').trim();
  const adapter = adapterId ? adapters.get(adapterId) : null;
  const dataSource = String(repeater?.dataSource || adapter?.sourceLibraryItemId || adapter?.collectionPath || '').trim();
  const item = adapter?.sourceLibraryItemId
    ? resolveDataSourceItem(adapter.sourceLibraryItemId, libById)
    : resolveDataSourceItem(dataSource, libById);
  return { adapterId: adapterId || null, adapter, dataSource, item };
}

function collectRepeaters(project, libById, adapters) {
  const out = [];
  walkNodes(project, (n) => {
    if (!n?.repeater || n.repeater.enabled !== true) return;
    const source = repeaterSource(n.repeater, adapters, libById);
    const sampleItems = Array.isArray(n.repeater.sampleItems)
      ? n.repeater.sampleItems.length
      : (Array.isArray(source.adapter?.sampleItems) ? source.adapter.sampleItems.length : 0);
    out.push({
      nodeId: n.id || null,
      adapterId: source.adapterId,
      dataSource: source.dataSource || null,
      collectionPath: source.adapter?.collectionPath || null,
      itemName: n.repeater.itemName || source.adapter?.itemName || 'item',
      previewCount: n.repeater.previewCount || null,
      sampleItems,
      libraryItemId: source.item?.id || null,
      assetType: source.item?.assetType || null,
      registered: Boolean(source.item),
    });
  });
  return out;
}

// The human "target" string for an action (lib id / node id / stage id / the param).
function targetLabel(ix) {
  return (
    ix.targetLibraryItemId ||
    ix.targetNodeId ||
    ix.targetStageId ||
    (ix.params && (ix.params.action || ix.params.url || ix.params.name)) ||
    'unnamed'
  );
}

function normMethod(m, fallback) {
  const s = String(m || '').trim().toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(s) ? s : fallback;
}

// Turn a free-form name/url into a clean leading-slash path segment.
function toPath(raw, fallback) {
  let s = String(raw || '').trim();
  if (!s) return fallback;
  // Strip a scheme+host if someone authored a full URL (we only want the path).
  const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  if (m) s = m[1] || '/';
  if (!s.startsWith('/')) s = '/' + s;
  // Collapse spaces, keep path-ish chars.
  s = s.replace(/\s+/g, '-').replace(/[^A-Za-z0-9/_\-.:{}]/g, '');
  return s || fallback;
}

// ── Derive the backend surface ──────────────────────────────────────────────
function deriveNeeds(project) {
  const libById = indexLibraryItems(project);
  const adapters = indexDataAdapters(project);
  const interactions = collectInteractions(project);
  const repeaters = collectRepeaters(project, libById, adapters);

  const endpoints = [];
  const databases = [];
  const authReasons = new Set();
  const seenEndpoint = new Set();
  const seenDb = new Set();

  const pushEndpoint = (e) => {
    const key = `${e.method} ${e.path}`;
    if (seenEndpoint.has(key)) return;
    seenEndpoint.add(key);
    endpoints.push(e);
  };

  for (const { ix, where } of interactions) {
    const action = String(ix.action || '').toUpperCase();
    const params = ix.params && typeof ix.params === 'object' ? ix.params : {};

    if (action === 'CALL_API') {
      const item = resolveTargetItem(ix, libById);
      const cfg = parseConfigJson(item);
      const target = targetLabel(ix);
      const name = (item && item.name) || target;
      const rawPath = cfg.path || cfg.url || cfg.endpoint || params.path || params.url || target;
      const method = normMethod(cfg.method || params.method, 'GET');
      const path_ = toPath(
        rawPath,
        '/' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '/api'
      );
      const payloadHint =
        cfg.requestBody || cfg.body || cfg.params
          ? 'json body (see api config)'
          : method === 'GET'
          ? 'query params'
          : 'json body';
      pushEndpoint({
        method,
        path: path_,
        name: String(name),
        payloadHint,
        source: item ? `libraryItems api "${item.id}"` : `CALL_API on ${where}`,
        target: String(target),
      });
    } else if (action === 'SUBMIT_FORM') {
      // A <form action=… method=…> → SUBMIT/SUBMIT_FORM (params.action / params.method).
      const method = normMethod(params.method, 'POST');
      const path_ = toPath(params.action, '/submit');
      pushEndpoint({
        method,
        path: path_,
        name: `form submit (${path_})`,
        payloadHint: 'form fields as json body',
        source: `SUBMIT_FORM on ${where}`,
        target: params.action || '(unspecified action)',
      });
    } else if (action === 'CALL_DATABASE') {
      const item = resolveTargetItem(ix, libById);
      const cfg = parseConfigJson(item);
      const target = targetLabel(ix);
      const name = (item && item.name) || target;
      const op = String(cfg.operation || cfg.op || params.operation || params.op || 'query').toLowerCase();
      const key = `${op}:${name}`;
      if (!seenDb.has(key)) {
        seenDb.add(key);
        databases.push({
          op,
          name: String(name),
          collection: cfg.table || cfg.collection || cfg.name || undefined,
          target: String(target),
          source: item ? `libraryItems database "${item.id}"` : `CALL_DATABASE on ${where}`,
      });
    }
  }

  for (const repeater of repeaters) {
    if (!repeater.dataSource) continue;
    const item = resolveDataSourceItem(repeater.dataSource, libById);
    if (!item) continue;
    const cfg = parseConfigJson(item);
    const source = `repeater "${repeater.nodeId || '?'}" dataSource "${repeater.dataSource}"`;
    const target = repeater.dataSource;
    if (String(item.assetType || '').toLowerCase() === 'api') {
      const name = item.name || item.id || target;
      const rawPath = cfg.path || cfg.url || cfg.endpoint || target;
      const method = normMethod(cfg.method, 'GET');
      const path_ = toPath(
        rawPath,
        '/' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '/api'
      );
      pushEndpoint({
        method,
        path: path_,
        name: String(name),
        payloadHint: method === 'GET' ? 'query params' : 'json body',
        source,
        target,
      });
    } else if (String(item.assetType || '').toLowerCase() === 'database') {
      const name = item.name || item.id || target;
      const op = String(cfg.operation || cfg.op || 'query').toLowerCase();
      const key = `${op}:${name}`;
      if (!seenDb.has(key)) {
        seenDb.add(key);
        databases.push({
          op,
          name: String(name),
          collection: cfg.table || cfg.collection || cfg.name || undefined,
          target,
          source,
        });
      }
    }
  }
  }

  // Auth detection: a PasswordField anywhere, or a SUBMIT_FORM whose action smells of
  // auth, or a node id/text mentioning login/sign-in implies the server needs auth.
  walkNodes(project, (n) => {
    if (n.kind === 'javafx.scene.control.PasswordField') {
      authReasons.add('a PasswordField is present (login/credential entry)');
    }
    const idText = `${n.id || ''} ${n.promptText || ''} ${n.text || ''}`.toLowerCase();
    if (/\b(log\s?in|sign\s?in|sign\s?up|register|password|auth)\b/.test(idText)) {
      authReasons.add(
        `auth-shaped node "${n.id || n.kind}" ("${(n.text || n.promptText || n.id || '').toString().slice(0, 40)}")`
      );
    }
  });
  for (const { ix } of interactions) {
    if (String(ix.action || '').toUpperCase() === 'SUBMIT_FORM') {
      const a = String((ix.params && ix.params.action) || '').toLowerCase();
      if (/login|signin|sign-in|auth|session|token/.test(a)) {
        authReasons.add(`a form posts to an auth-shaped action ("${a}")`);
      }
    }
  }

  return {
    endpoints,
    databases,
    repeaters,
    auth: { needed: authReasons.size > 0, reasons: [...authReasons] },
  };
}

// ── Toolchain detection ─────────────────────────────────────────────────────
// Probe '<tool> <versionArg>' and capture presence + the first non-empty output line
// as the version. spawnSync never throws with default opts: a missing binary yields
// { status:null, error:{code:'ENOENT'} }; we treat that (and any error) as absent.
function probe(cmd, args = ['--version']) {
  let r;
  try {
    r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 4000 });
  } catch {
    return { present: false, version: null };
  }
  if (r.error || r.status === null) return { present: false, version: null };
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const line = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  // Many tools print non-zero on --version (or print to stderr); presence = it ran.
  return { present: true, version: line.slice(0, 80) || null };
}

function detectToolchain() {
  const runtimes = {
    node: probe('node'),
    npm: probe('npm'),
    pnpm: probe('pnpm'),
    yarn: probe('yarn'),
    bun: probe('bun'),
    python3: probe('python3'),
    pip: probe('pip3'),
    poetry: probe('poetry'),
    uv: probe('uv'),
    go: probe('go', ['version']),
    cargo: probe('cargo'),
    java: probe('java', ['-version']),
    mvn: probe('mvn', ['-v']),
  };
  const deploy = {
    docker: probe('docker'),
    gcloud: probe('gcloud', ['version']),
    flyctl: probe('flyctl', ['version']),
    vercel: probe('vercel', ['--version']),
    netlify: probe('netlify', ['--version']),
    supabase: probe('supabase', ['--version']),
    railway: probe('railway', ['--version']),
    wrangler: probe('wrangler', ['--version']),
  };
  return { runtimes, deploy };
}

// ── Recommendation ──────────────────────────────────────────────────────────
function has(d, k) {
  return d && d[k] && d[k].present;
}

function recommend(needs, detected) {
  const rt = detected.runtimes;
  const dep = detected.deploy;
  const reasons = [];

  // Stack: prefer a BaaS only when the surface is auth+db-heavy AND a BaaS CLI exists;
  // otherwise a typed server runtime that's installed. Default Node (most ubiquitous).
  const dbHeavy = needs.databases.length > 0;
  const apiCount = needs.endpoints.length;

  let stack;
  if (dbHeavy && needs.auth.needed && (has(dep, 'supabase') || has(rt, 'node'))) {
    stack = has(dep, 'supabase') ? 'supabase' : 'node-hono';
    reasons.push(
      has(dep, 'supabase')
        ? 'auth + database surface and the Supabase CLI is installed — a BaaS gives you auth + Postgres + row APIs out of the box'
        : 'auth + database surface; Supabase CLI absent, so a Node server with a DB client is the portable default'
    );
  } else if (has(rt, 'node')) {
    stack = 'node-hono';
    reasons.push(
      apiCount <= 6
        ? `${apiCount} endpoint(s): a single Hono app on Node is the lightest thing that runs everywhere`
        : `${apiCount} endpoints: Hono on Node scales to a real router while staying dependency-light`
    );
  } else if (has(rt, 'python3')) {
    stack = 'python-fastapi';
    reasons.push('Node not detected but Python is — FastAPI gives typed routes + OpenAPI');
  } else if (has(rt, 'go')) {
    stack = 'go-nethttp';
    reasons.push('Only Go detected — a net/http server is a single static binary');
  } else {
    stack = 'mock-local';
    reasons.push('no server runtime detected — start with a mock/local-first server and install a runtime');
  }

  // Deploy target: gcloud -> Cloud Run is the documented default; else the first
  // installed PaaS CLI; else Docker on a VPS; else a "install a CLI" note.
  let deployTarget;
  if (has(dep, 'gcloud')) {
    deployTarget = 'cloud-run';
    reasons.push('gcloud is installed — Cloud Run is the default (scale-to-zero container, dev.nativeui.com convention)');
  } else if (has(dep, 'flyctl')) {
    deployTarget = 'fly';
    reasons.push('flyctl installed — Fly.io runs the container close to users');
  } else if (has(dep, 'railway')) {
    deployTarget = 'railway';
    reasons.push('railway CLI installed — Railway deploys straight from the repo');
  } else if (stack === 'node-hono' && (has(dep, 'vercel') || has(dep, 'netlify'))) {
    deployTarget = has(dep, 'vercel') ? 'vercel' : 'netlify';
    reasons.push(`${deployTarget} CLI installed and the stack is Node — deploy as serverless functions`);
  } else if (stack === 'supabase') {
    deployTarget = 'supabase';
    reasons.push('Supabase hosts the BaaS itself (managed) — deploy edge functions with the supabase CLI');
  } else if (has(dep, 'docker')) {
    deployTarget = 'docker-vps';
    reasons.push('no PaaS CLI but Docker is installed — ship the container to any VPS');
  } else {
    deployTarget = 'cloud-run';
    reasons.push('no deploy CLI detected — Cloud Run is the recommended target; install the gcloud CLI to deploy');
  }

  return { stack, deployTarget, reason: reasons.join('; ') };
}

// ── Human summary ───────────────────────────────────────────────────────────
function renderHuman(plan, projectPath) {
  const L = [];
  const { needs, detected, recommended } = plan;
  L.push(`NativeUI backend plan for ${path.basename(projectPath)}`);
  L.push('');
  L.push(`Endpoints (${needs.endpoints.length}):`);
  if (!needs.endpoints.length) L.push('  (none — no CALL_API, form SUBMIT_FORM, or api-backed repeaters found)');
  for (const e of needs.endpoints) {
    L.push(`  ${e.method.padEnd(6)} ${e.path}   [${e.name}] — ${e.payloadHint}  (${e.source})`);
  }
  L.push('');
  L.push(`Database ops (${needs.databases.length}):`);
  if (!needs.databases.length) L.push('  (none — no CALL_DATABASE actions or database-backed repeaters found)');
  for (const d of needs.databases) {
    L.push(`  ${d.op}${d.collection ? ` on ${d.collection}` : ''}   [${d.name}]  (${d.source})`);
  }
  L.push('');
  L.push(`Repeaters (${needs.repeaters.length}):`);
  if (!needs.repeaters.length) L.push('  (none)');
  for (const r of needs.repeaters) {
    L.push(`  ${r.nodeId || '?'} -> ${r.dataSource || '(no dataSource)'}${r.registered ? ` (${r.assetType}:${r.libraryItemId})` : ' (unregistered)'}`);
  }
  L.push('');
  L.push(`Auth: ${needs.auth.needed ? 'NEEDED' : 'not detected'}`);
  for (const r of needs.auth.reasons) L.push(`  - ${r}`);
  L.push('');
  const present = (group) =>
    Object.entries(detected[group])
      .filter(([, v]) => v.present)
      .map(([k, v]) => `${k}${v.version ? ` (${v.version})` : ''}`)
      .join(', ') || '(none)';
  L.push(`Detected runtimes: ${present('runtimes')}`);
  L.push(`Detected deploy CLIs: ${present('deploy')}`);
  L.push('');
  L.push(`Recommended stack:  ${recommended.stack}`);
  L.push(`Recommended deploy: ${recommended.deployTarget}`);
  L.push(`Why: ${recommended.reason}`);
  return L.join('\n') + '\n';
}

async function main() {
  try {
    const { project, format } = parseArgs(process.argv.slice(2));

    // FAIL CLOSED on the project BEFORE probing the toolchain.
    let raw;
    try {
      raw = await fs.readFile(project, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new BackendPlanError(`Project file not found: ${project}\n${USAGE}`);
      throw new BackendPlanError(`Could not read ${project}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new BackendPlanError(`${project} is not valid JSON: ${e.message}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BackendPlanError(`${project} must be a JSON object (a ProjectState).`);
    }
    if (!Array.isArray(parsed.stages) || parsed.stages.length === 0) {
      throw new BackendPlanError(
        `${project} has no stages[] — not a NativeUI project. Import HTML first (nui-import.mjs).`
      );
    }

    const needs = deriveNeeds(parsed);
    const detected = detectToolchain();
    const recommended = recommend(needs, detected);
    const plan = { needs, detected, recommended };

    if (format === 'human') {
      process.stdout.write(renderHuman(plan, project));
    } else {
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof BackendPlanError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
