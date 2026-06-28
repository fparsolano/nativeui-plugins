// nui-preview.mjs — preview a project.json in the web companion editor BEFORE
// exporting/building it.
//
// The reliable path: cloud-SAVE the project (the SAME profile-api create-or-update
// path nui-save.mjs uses), then point the user at the web companion editor
// (webapp.<env>.nativeui.com), which auto-signs-in from the main-site session and
// opens the saved project from "Open from cloud". A project saved this way also
// opens in the desktop editor — it is the shared cloud document.
//
// Why this path: the web companion has no per-project DEEP-LINK route — it opens a
// saved project via its in-app cloud picker (EditorApp.openFromCloud), keyed by the
// saved NAME. So the only reliable "see it live" flow is: save → open the editor →
// pick the project by name. We surface the exact URL + name to make that one click.
//
// If you only want to confirm the project is well-formed without a cloud save, pass
// --no-save: it validates the JSON locally and prints the editor URL + how to open,
// but does NOT upload (so there is nothing to pick yet — it falls back to a note and
// exits non-zero, because there is no live preview without a save). Use nui-validate
// for a pure local/structural check.
//
// Usage:
//   node bin/nui-preview.mjs <project.json> --name "My App" [--location "Folder"] [--open] [--no-save]
//
// Requires being logged in (run bin/login.mjs first) for the cloud-save path. Name
// is required when saving (the editor lists/opens projects by name). Fails closed on
// missing config/auth.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getConfig, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { requireNativeUiAuthMode } from './auth-mode.mjs';

class PreviewError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PreviewError';
  }
}

const USAGE =
  'Usage: node bin/nui-preview.mjs <project.json> --name "Project Name" [--location "Folder"] [--open] [--no-save]';

function parseArgs(argv) {
  let file = '';
  let name = '';
  let location = '';
  let open = false;
  let save = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') {
      name = argv[++i];
      if (name === undefined) throw new PreviewError('--name requires a value.');
    } else if (a === '--location' || a === '-l') {
      location = argv[++i] || '';
    } else if (a === '--open') {
      open = true;
    } else if (a === '--no-save') {
      save = false;
    } else if (a === '-h' || a === '--help') {
      throw new PreviewError(USAGE);
    } else if (a.startsWith('-')) {
      throw new PreviewError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!file) {
      file = a;
    } else {
      throw new PreviewError(`Unexpected extra argument: ${a}\n${USAGE}`);
    }
  }
  if (!file) throw new PreviewError(`No project file given.\n${USAGE}`);
  if (save && (!name || !name.trim())) {
    throw new PreviewError(
      'A project name is required to preview (the editor opens cloud projects by name).\n' +
        '  Add: --name "Project Name"   (or pass --no-save to skip the cloud upload)'
    );
  }
  return { file, name: (name || '').trim(), location: (location || '').trim(), open, save };
}

/** Base URL for profile-api: explicit override, else <exportServiceUrl>/api/profile (Hosting rewrite). */
function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
}

/**
 * The web companion editor origin. The editor lives at webapp.<env> of the export
 * host: dev.nativeui.com -> webapp.dev.nativeui.com, nativeui.com -> webapp.nativeui.com
 * (mirrors nui-web/src/cloud/sso.ts, which derives the sign-in origin by STRIPPING the
 * "webapp." label — we ADD it). An explicit override wins for non-standard hosts.
 */
function webEditorUrl(config) {
  const override = (process.env.NATIVEUI_WEB_EDITOR_URL || '').replace(/\/+$/, '');
  if (override) return override;
  let host;
  try {
    host = new URL(config.exportServiceUrl).host;
  } catch {
    return ''; // non-URL export host (e.g. bare hostname) — caller falls back to a note.
  }
  // Already a webapp.* host? use as-is; else prefix the label.
  const editorHost = host.startsWith('webapp.') ? host : `webapp.${host}`;
  return `https://${editorHost}`;
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
    throw new PreviewError(`Network error contacting profile service: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new PreviewError('Authentication rejected by profile service.\n  Run: node bin/login.mjs');
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new PreviewError(`Profile service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new PreviewError(`${method} ${pathSuffix} failed (HTTP ${res.status}): ${json.error || text.slice(0, 300)}`);
  }
  return json;
}

async function readProjectContent(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new PreviewError(`Project file not found: ${file}`);
    throw new PreviewError(`Could not read ${file}: ${e.message}`);
  }
  // Validate it's JSON (don't push a broken project), but send the original text verbatim.
  try {
    JSON.parse(raw);
  } catch (e) {
    throw new PreviewError(`${file} is not valid JSON: ${e.message}`);
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

/** Best-effort open a URL in the user's browser. Returns the opener used, or null. */
function tryOpen(url) {
  const candidates =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [['xdg-open', [url]]];
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

async function main() {
  try {
    const { file, name, location, open, save } = parseArgs(process.argv.slice(2));
    const config = await getConfig();
    const editorUrl = webEditorUrl(config);
    const contentJson = await readProjectContent(path.resolve(file));

    // --no-save: there is no live preview without a saved project (no deep-link
    // route). Validate locally, print the editor URL, and FAIL CLOSED so the caller
    // doesn't mistake "URL printed" for "previewable".
    if (!save) {
      process.stderr.write(
        `Local check only (--no-save): ${path.basename(file)} is valid JSON, but NOT uploaded.\n` +
          (editorUrl
            ? `  The web editor is ${editorUrl}, but it can only open a project that has been\n` +
              `  cloud-SAVED (it opens by name from "Open from cloud" — there is no deep-link).\n`
            : `  (Could not derive the web editor URL from exportServiceUrl.)\n`) +
          `  Re-run WITHOUT --no-save (add --name) to upload and preview, or use nui-validate\n` +
          `  for a pure structural check.\n`
      );
      process.exit(1);
    }

    requireNativeUiAuthMode(config, 'nui-preview');
    const token = await getFreshToken();
    const base = profileApiBase(config);
    const syncMeta = await readSyncMeta(file);

    // Create-or-update BY NAME (same as nui-save): re-previewing the same name updates it.
    const list = await apiRequest(base, token, 'GET', '/projects');
    const items = Array.isArray(list.items) ? list.items : [];
    const existing = items.find((p) => (p.name || '').trim() === name);

    let projectId;
    let action;
    if (existing) {
      const updated = await apiRequest(base, token, 'PUT', `/projects/${encodeURIComponent(existing.id)}/content`, {
        contentJson,
        ...(syncMeta?.projectId === existing.id && syncMeta.revision != null
          ? { expectedRevision: syncMeta.revision }
          : {}),
      });
      let row = updated;
      if (location) {
        row = await apiRequest(base, token, 'PATCH', `/projects/${encodeURIComponent(existing.id)}`, { location });
      }
      projectId = existing.id;
      await writeSyncMeta(file, { ...row, id: projectId, name }, contentJson, location);
      action = 'Updated';
    } else {
      const created = await apiRequest(base, token, 'POST', '/projects', { name, location, contentJson });
      projectId = created.id;
      await writeSyncMeta(file, created, contentJson, location);
      action = 'Created';
    }

    process.stdout.write(`${action} cloud project "${name}" (id: ${projectId}) for preview.\n`);
    if (editorUrl) {
      process.stdout.write(
        `\nPreview it in the web editor:\n` +
          `  1. Open ${editorUrl}\n` +
          `     (you're signed in automatically from your nativeui.com session)\n` +
          `  2. Open from cloud -> pick "${name}"\n` +
          `It also opens in the desktop editor — it's the shared cloud document.\n`
      );
    } else {
      process.stdout.write(
        `\n(Could not derive the web editor URL from exportServiceUrl="${config.exportServiceUrl}";\n` +
          ` open your NativeUI web editor and pick "${name}" from Open-from-cloud.)\n`
      );
    }

    if (open && editorUrl) {
      const opener = tryOpen(editorUrl);
      if (opener) process.stdout.write(`Opened ${editorUrl} (via ${opener}).\n`);
      else process.stdout.write(`(Could not auto-open a browser — open ${editorUrl} manually.)\n`);
    }

    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof PreviewError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

// Run only when invoked directly (so tests can import the helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseArgs, webEditorUrl, profileApiBase };
