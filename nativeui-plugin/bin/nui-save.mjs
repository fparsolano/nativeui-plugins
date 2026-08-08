// nui-save.mjs — save a NativeUI project.json to the user's cloud account.
//
// Talks to the SAME profile-api project CRUD the desktop + web editors use
// (users/{uid}/projects: name, location, contentJson). Create-or-update BY NAME:
//   - GET  /api/profile/projects                 → find an existing project with the same name
//   - PUT  /api/profile/projects/:id/content      → update it (if found)
//   - POST /api/profile/projects                  → create it (if not), with the content inline
// A project saved here opens in the desktop editor and the web editor (shared cloud saves).
//
// Usage:
//   node bin/nui-save.mjs project.json --name "My App" [--location "Folder"]
//   node bin/nui-save.mjs --name "My App" project.json
//
// Requires being logged in (run bin/login.mjs first). Name is required.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getConfig, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { requireNativeUiAuthMode } from './auth-mode.mjs';

class SaveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveError';
  }
}

function parseArgs(argv) {
  let file = '';
  let name = '';
  let location = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') {
      name = argv[++i];
      if (name === undefined) throw new SaveError('--name requires a value.');
    } else if (a === '--location' || a === '-l') {
      location = argv[++i] || '';
    } else if (a === '-h' || a === '--help') {
      throw new SaveError('Usage: node bin/nui-save.mjs <project.json> --name "Project Name" [--location "Folder"]');
    } else if (a.startsWith('-')) {
      throw new SaveError(`Unknown flag: ${a}`);
    } else if (!file) {
      file = a;
    } else {
      throw new SaveError(`Unexpected extra argument: ${a}`);
    }
  }
  if (!file) {
    throw new SaveError('No project file given.\n  Usage: node bin/nui-save.mjs <project.json> --name "Project Name"');
  }
  if (!name || !name.trim()) {
    throw new SaveError('A project name is required.\n  Add: --name "Project Name"');
  }
  return { file, name: name.trim(), location: (location || '').trim() };
}

/** Base URL for profile-api: explicit override, else <exportServiceUrl>/api/profile (Hosting rewrite). */
function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
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
    throw new SaveError(`Network error contacting profile service: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SaveError('Authentication rejected by profile service.\n  Run: node bin/login.mjs');
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new SaveError(`Profile service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new SaveError(`${method} ${pathSuffix} failed (HTTP ${res.status}): ${json.error || text.slice(0, 300)}`);
  }
  return json;
}

async function readProjectContent(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new SaveError(`Project file not found: ${file}`);
    throw new SaveError(`Could not read ${file}: ${e.message}`);
  }
  // Validate it's JSON (don't push a broken project), but send the original text verbatim.
  try {
    JSON.parse(raw);
  } catch (e) {
    throw new SaveError(`${file} is not valid JSON: ${e.message}`);
  }
  return raw;
}

function sidecarPath(file) {
  return `${path.resolve(file)}.nativeui-sync.json`;
}

function hashText(text) {
  return createHash('sha256').update(text || '', 'utf8').digest('hex');
}

async function readSyncMeta(file) {
  try {
    return JSON.parse(await fs.readFile(sidecarPath(file), 'utf8'));
  } catch {
    return null;
  }
}

async function writeSyncMeta(file, row, contentJson, location = '') {
  if (!row?.id) return;
  await fs.writeFile(
    sidecarPath(file),
    JSON.stringify(
      {
        version: 1,
        projectId: row.id,
        name: row.name || '',
        location: row.location || location || '',
        revision: Number.isFinite(Number(row.revision)) ? Number(row.revision) : null,
        updatedAt: row.updated_at || '',
        contentHash: hashText(contentJson),
        syncedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
}

async function main() {
  try {
    const { file, name, location } = parseArgs(process.argv.slice(2));
    const config = await getConfig();
    requireNativeUiAuthMode(config, 'nui-save');
    const token = await getFreshToken();
    const base = profileApiBase(config);
    const contentJson = await readProjectContent(path.resolve(file));
    const syncMeta = await readSyncMeta(file);

    // Find an existing project with the same name (create-or-update by name).
    const list = await apiRequest(base, token, 'GET', '/projects');
    const items = Array.isArray(list.items) ? list.items : [];
    const existing = items.find((p) => (p.name || '').trim() === name);

    let result;
    let action;
    if (existing) {
      result = await apiRequest(base, token, 'PUT', `/projects/${encodeURIComponent(existing.id)}/content`, {
        contentJson,
        ...(syncMeta?.projectId === existing.id && syncMeta.revision != null
          ? { expectedRevision: syncMeta.revision }
          : {}),
      });
      if (location) {
        // Keep the folder/location in sync when provided.
        result = await apiRequest(base, token, 'PATCH', `/projects/${encodeURIComponent(existing.id)}`, { location });
      }
      action = 'Updated';
    } else {
      result = await apiRequest(base, token, 'POST', '/projects', { name, location, contentJson });
      action = 'Created';
    }

    await writeSyncMeta(file, { ...result, name }, contentJson, location);

    process.stdout.write(`${action} cloud project "${name}" (id: ${result.id})\n`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof SaveError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
