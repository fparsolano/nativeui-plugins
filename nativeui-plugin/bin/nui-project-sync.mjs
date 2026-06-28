#!/usr/bin/env node
// nui-project-sync.mjs — guarded cloud sync for NativeUI project.json.
//
// Commands:
//   status <project.json> (--project-id <id> | --name <name>) [--json|--human]
//   pull   <project.json> (--project-id <id> | --name <name>) [--json|--human]
//   push   <project.json> --name <name> [--project-id <id>] [--location <folder>] [--json|--human]
//
// The sidecar <project.json>.nativeui-sync.json records the last synced cloud
// revision + content hash. push sends expectedRevision and fails closed on 409.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getConfig, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { requireNativeUiAuthMode } from './auth-mode.mjs';

class SyncError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncError';
  }
}

const USAGE = 'Usage: node bin/nui-project-sync.mjs status|pull|push <project.json> (--project-id <id> | --name <name>) [--location <folder>] [--json|--human]';

function parseArgs(argv) {
  const command = argv.shift();
  if (!['status', 'pull', 'push'].includes(command)) throw new SyncError(USAGE);
  let file = '';
  let projectId = '';
  let name = '';
  let location = '';
  let format = 'json';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-id') projectId = argv[++i] || '';
    else if (a === '--name' || a === '-n') name = argv[++i] || '';
    else if (a === '--location' || a === '-l') location = argv[++i] || '';
    else if (a === '--json') format = 'json';
    else if (a === '--human') format = 'human';
    else if (a === '-h' || a === '--help') throw new SyncError(USAGE);
    else if (a.startsWith('-')) throw new SyncError(`Unknown flag: ${a}\n${USAGE}`);
    else if (!file) file = a;
    else throw new SyncError(`Unexpected argument: ${a}\n${USAGE}`);
  }
  if (!file) throw new SyncError(`Missing <project.json>.\n${USAGE}`);
  if (!projectId && !name) throw new SyncError(`Provide --project-id or --name.\n${USAGE}`);
  if (command === 'push' && !name) throw new SyncError('push requires --name so a missing cloud project can be created.');
  return { command, file, projectId, name: name.trim(), location: location.trim(), format };
}

function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
}

function sidecarPath(file) {
  return `${path.resolve(file)}.nativeui-sync.json`;
}

function hashText(text) {
  return createHash('sha256').update(text || '', 'utf8').digest('hex');
}

async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function readLocalProject(file, required = true) {
  const text = await readTextIfExists(path.resolve(file));
  if (text == null) {
    if (required) throw new SyncError(`Project file not found: ${file}`);
    return null;
  }
  try {
    JSON.parse(text);
  } catch (e) {
    throw new SyncError(`${file} is not valid JSON: ${e.message}`);
  }
  return text;
}

async function readMeta(file) {
  const text = await readTextIfExists(sidecarPath(file));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeMeta(file, meta) {
  const out = {
    version: 1,
    ...meta,
    syncedAt: new Date().toISOString(),
  };
  await fs.writeFile(sidecarPath(file), JSON.stringify(out, null, 2) + '\n');
  return out;
}

async function apiRequest(base, token, method, pathSuffix, body) {
  let res;
  try {
    res = await fetch(`${base}${pathSuffix}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new SyncError(`Network error contacting profile service: ${e.message}`);
  }
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new SyncError(`Profile service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 409) {
    const err = new SyncError(`Cloud project changed since last sync (revision ${json.revision ?? 'unknown'}). Pull first or save a new draft.`);
    err.code = 'revision_mismatch';
    err.payload = json;
    throw err;
  }
  if (!res.ok) throw new SyncError(`${method} ${pathSuffix} failed (HTTP ${res.status}): ${json.error || text.slice(0, 300)}`);
  return json;
}

async function resolveCloudProject(base, token, { projectId, name }) {
  const list = await apiRequest(base, token, 'GET', '/projects');
  const items = Array.isArray(list.items) ? list.items : [];
  const row = projectId ? items.find((p) => p.id === projectId) : items.find((p) => (p.name || '').trim() === name);
  return row || null;
}

async function fetchContent(base, token, id) {
  const payload = await apiRequest(base, token, 'GET', `/projects/${encodeURIComponent(id)}/content`);
  return {
    contentJson: payload.contentJson || '',
    revision: Number.isFinite(Number(payload.revision)) ? Number(payload.revision) : 0,
    updatedAt: payload.updated_at || payload.updatedAt || '',
  };
}

function summarizeStatus({ localText, meta, cloudRow, cloudContent }) {
  const localHash = localText == null ? '' : hashText(localText);
  const cloudHash = cloudContent ? hashText(cloudContent.contentJson || '') : '';
  const cloudRevision = cloudContent?.revision ?? cloudRow?.revision ?? null;
  const localChanged = Boolean(meta?.contentHash && localHash && localHash !== meta.contentHash);
  const cloudChanged = Boolean(meta && cloudRevision != null && cloudRevision !== meta.revision);
  const conflict = localChanged && cloudChanged && localHash !== cloudHash;
  return {
    projectId: cloudRow?.id || meta?.projectId || null,
    name: cloudRow?.name || meta?.name || null,
    localHash,
    cloudHash,
    localRevision: meta?.revision ?? null,
    cloudRevision,
    localChanged,
    cloudChanged,
    conflict,
    inSync: Boolean(localHash && cloudHash && localHash === cloudHash),
  };
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const config = await getConfig();
    requireNativeUiAuthMode(config, 'nui-project-sync');
    const token = await getFreshToken();
    const base = profileApiBase(config);
    const meta = await readMeta(opts.file);
    const localText = await readLocalProject(opts.file, opts.command !== 'pull');
    const cloudRow = await resolveCloudProject(base, token, {
      projectId: opts.projectId || meta?.projectId || '',
      name: opts.name || meta?.name || '',
    });

    if (!cloudRow && opts.command !== 'push') throw new SyncError('Cloud project not found.');

    if (opts.command === 'status') {
      const cloudContent = cloudRow ? await fetchContent(base, token, cloudRow.id) : null;
      const report = summarizeStatus({ localText, meta, cloudRow, cloudContent });
      emit(report, opts.format);
      process.exit(report.conflict ? 2 : 0);
    }

    if (opts.command === 'pull') {
      const cloudContent = await fetchContent(base, token, cloudRow.id);
      await fs.mkdir(path.dirname(path.resolve(opts.file)), { recursive: true });
      await fs.writeFile(path.resolve(opts.file), cloudContent.contentJson);
      const written = await writeMeta(opts.file, {
        projectId: cloudRow.id,
        name: cloudRow.name,
        location: cloudRow.location || '',
        revision: cloudContent.revision,
        updatedAt: cloudContent.updatedAt || cloudRow.updated_at || '',
        contentHash: hashText(cloudContent.contentJson),
      });
      emit({ action: 'pulled', projectId: cloudRow.id, revision: written.revision, metadata: sidecarPath(opts.file) }, opts.format);
      process.exit(0);
    }

    let result;
    let action;
    if (cloudRow) {
      const expectedRevision = meta?.projectId === cloudRow.id ? meta.revision : undefined;
      result = await apiRequest(base, token, 'PUT', `/projects/${encodeURIComponent(cloudRow.id)}/content`, {
        contentJson: localText,
        ...(expectedRevision != null ? { expectedRevision } : {}),
      });
      if (opts.location) {
        result = await apiRequest(base, token, 'PATCH', `/projects/${encodeURIComponent(cloudRow.id)}`, { location: opts.location });
      }
      action = 'updated';
    } else {
      result = await apiRequest(base, token, 'POST', '/projects', {
        name: opts.name,
        location: opts.location,
        contentJson: localText,
      });
      action = 'created';
    }
    const revision = Number.isFinite(Number(result.revision)) ? Number(result.revision) : null;
    await writeMeta(opts.file, {
      projectId: result.id,
      name: result.name || opts.name,
      location: result.location || opts.location,
      revision,
      updatedAt: result.updated_at || '',
      contentHash: hashText(localText),
    });
    emit({ action, projectId: result.id, name: result.name || opts.name, revision, metadata: sidecarPath(opts.file) }, opts.format);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof SyncError) {
      process.stderr.write(err.message + '\n');
      process.exit(err.code === 'revision_mismatch' ? 2 : 1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

function emit(payload, format) {
  if (format === 'human') {
    if (payload.conflict) process.stdout.write('Conflict: local and cloud both changed since last sync.\n');
    else if (payload.inSync) process.stdout.write(`In sync: ${payload.name || payload.projectId} at revision ${payload.cloudRevision}\n`);
    else if (payload.action) process.stdout.write(`${payload.action}: ${payload.name || payload.projectId} revision ${payload.revision}\n`);
    else process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseArgs, hashText, sidecarPath, summarizeStatus, profileApiBase };
