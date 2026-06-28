#!/usr/bin/env node
// nui-library.mjs — manage NativeUI API/database library items and secrets.
//
// Local project edits:
//   upsert-api <project.json> --name <name> [--item-id <id>] [--base-url ...] [--path ...] [--method GET]
//   upsert-database <project.json> --name <name> [--item-id <id>] [--connector postgresql] [--host ...]
//
// Account secret operations:
//   put-secret --project-id <id> --item-id <id> --kind api|database --secret-stdin
//   secret-status --project-id <id> --item-id <id>
//   test --project-id <id> --item-id <id> --kind api|database --config-json <json>
//
// Secrets are never written to project.json. put-secret reads from stdin only.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { requireNativeUiAuthMode } from './auth-mode.mjs';

class LibraryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryError';
  }
}

const USAGE = 'Usage: node bin/nui-library.mjs upsert-api|upsert-database <project.json> --name <name> [flags] OR put-secret|secret-status|test --project-id <id> --item-id <id> ...';
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const API_AUTHS = new Set(['none', 'bearer', 'basic', 'api_key_header', 'api_key_query', 'custom']);

function parseArgs(argv) {
  const command = argv.shift();
  if (!['upsert-api', 'upsert-database', 'put-secret', 'secret-status', 'test'].includes(command)) {
    throw new LibraryError(USAGE);
  }
  const opts = { command, headers: [], format: 'json' };
  if (command.startsWith('upsert')) {
    opts.file = argv.shift() || '';
    if (!opts.file || opts.file.startsWith('-')) throw new LibraryError(`Missing <project.json>.\n${USAGE}`);
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new LibraryError(`${a} requires a value.`);
      return v;
    };
    if (a === '--name' || a === '-n') opts.name = next();
    else if (a === '--item-id') opts.itemId = next();
    else if (a === '--base-url') opts.baseUrl = next();
    else if (a === '--path') opts.path = next();
    else if (a === '--method') opts.method = next();
    else if (a === '--header') opts.headers.push(next());
    else if (a === '--auth-type') opts.authType = next();
    else if (a === '--auth-username') opts.authUsername = next();
    else if (a === '--api-key-name') opts.apiKeyName = next();
    else if (a === '--open-api-spec-url') opts.openApiSpecUrl = next();
    else if (a === '--connector') opts.connectorId = next();
    else if (a === '--host') opts.host = next();
    else if (a === '--port') opts.port = next();
    else if (a === '--database') opts.databaseName = next();
    else if (a === '--jdbc-url') opts.jdbcUrl = next();
    else if (a === '--username') opts.username = next();
    else if (a === '--test-query') opts.testQuery = next();
    else if (a === '--table') opts.table = next();
    else if (a === '--collection') opts.collection = next();
    else if (a === '--operation') opts.operation = next();
    else if (a === '--project-id') opts.projectId = next();
    else if (a === '--kind') opts.kind = next();
    else if (a === '--config-json') opts.configJson = next();
    else if (a === '--secret-stdin') opts.secretStdin = true;
    else if (a === '--json') opts.format = 'json';
    else if (a === '--human') opts.format = 'human';
    else if (a === '-h' || a === '--help') throw new LibraryError(USAGE);
    else if (a.startsWith('-')) throw new LibraryError(`Unknown flag: ${a}\n${USAGE}`);
    else throw new LibraryError(`Unexpected argument: ${a}\n${USAGE}`);
  }
  validateArgs(opts);
  return opts;
}

function validateArgs(opts) {
  if (opts.command.startsWith('upsert') && !String(opts.name || '').trim()) throw new LibraryError(`${opts.command} requires --name.`);
  if (opts.command === 'upsert-api') {
    if (opts.method && !API_METHODS.has(String(opts.method).toUpperCase())) throw new LibraryError(`--method must be one of ${[...API_METHODS].join('|')}.`);
    if (opts.authType && !API_AUTHS.has(String(opts.authType))) throw new LibraryError(`--auth-type must be one of ${[...API_AUTHS].join('|')}.`);
  }
  if (['put-secret', 'secret-status', 'test'].includes(opts.command)) {
    if (!opts.projectId) throw new LibraryError(`${opts.command} requires --project-id.`);
    if (!opts.itemId) throw new LibraryError(`${opts.command} requires --item-id.`);
  }
  if (opts.command === 'put-secret') {
    if (!['api', 'database'].includes(opts.kind)) throw new LibraryError('put-secret requires --kind api|database.');
    if (!opts.secretStdin) throw new LibraryError('put-secret requires --secret-stdin; secret values are never accepted as command arguments.');
  }
  if (opts.command === 'test') {
    if (!['api', 'database'].includes(opts.kind)) throw new LibraryError('test requires --kind api|database.');
    if (!opts.configJson) throw new LibraryError('test requires --config-json.');
  }
}

function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
}

function slug(value) {
  const s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'library-item';
}

function itemId(kind, name) {
  return `lib-${kind}-${slug(name)}`;
}

function parseHeaders(lines) {
  const headers = {};
  for (const line of lines || []) {
    const i = line.indexOf(':');
    if (i <= 0) throw new LibraryError(`Invalid --header "${line}". Use "Name: value".`);
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

async function readProject(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    throw new LibraryError(e.code === 'ENOENT' ? `Project file not found: ${file}` : `Could not read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new LibraryError(`${file} is not valid JSON: ${e.message}`);
  }
}

function apiConfig(opts) {
  const cfg = {};
  if (opts.baseUrl) cfg.baseUrl = opts.baseUrl;
  if (opts.path) cfg.path = opts.path;
  if (opts.method) cfg.method = String(opts.method).toUpperCase();
  const headers = parseHeaders(opts.headers);
  if (Object.keys(headers).length) cfg.headers = headers;
  if (opts.authType) cfg.authType = opts.authType;
  if (opts.authUsername) cfg.authUsername = opts.authUsername;
  if (opts.apiKeyName) cfg.apiKeyName = opts.apiKeyName;
  if (opts.openApiSpecUrl) cfg.openApiSpecUrl = opts.openApiSpecUrl;
  return cfg;
}

function databaseConfig(opts) {
  const cfg = {};
  for (const [key, value] of [
    ['connectorId', opts.connectorId],
    ['host', opts.host],
    ['databaseName', opts.databaseName],
    ['jdbcUrl', opts.jdbcUrl],
    ['username', opts.username],
    ['testQuery', opts.testQuery],
    ['table', opts.table],
    ['collection', opts.collection],
    ['operation', opts.operation],
  ]) {
    if (value) cfg[key] = value;
  }
  if (opts.port) cfg.port = Number.parseInt(opts.port, 10) || undefined;
  return cfg;
}

async function upsert(opts) {
  const projectPath = path.resolve(opts.file);
  const project = await readProject(projectPath);
  project.libraryItems = Array.isArray(project.libraryItems) ? project.libraryItems : [];
  const kind = opts.command === 'upsert-database' ? 'database' : 'api';
  const id = opts.itemId || itemId(kind, opts.name);
  const existing = project.libraryItems.find((item) => item && item.id === id);
  const item = existing || { id };
  item.name = String(opts.name).trim();
  item.assetType = kind;
  item.configJson = JSON.stringify(kind === 'api' ? apiConfig(opts) : databaseConfig(opts));
  if (!existing) project.libraryItems.push(item);
  await fs.writeFile(projectPath, JSON.stringify(project, null, 2) + '\n');
  return { action: existing ? 'updated' : 'created', item: redactedItem(item), project: projectPath };
}

function redactedItem(item) {
  return {
    id: item.id,
    name: item.name,
    assetType: item.assetType,
    configJson: item.configJson,
    ...(item.secretRef ? { secretRef: item.secretRef } : {}),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
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
    throw new LibraryError(`Network error contacting profile service: ${e.message}`);
  }
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new LibraryError(`Profile service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new LibraryError(`${method} ${pathSuffix} failed (HTTP ${res.status}): ${json.error || text.slice(0, 300)}`);
  return json;
}

async function accountOperation(opts) {
  const config = await getConfig();
  requireNativeUiAuthMode(config, 'nui-library account operations');
  const token = await getFreshToken();
  const base = profileApiBase(config);
  const project = encodeURIComponent(opts.projectId);
  const item = encodeURIComponent(opts.itemId);
  if (opts.command === 'secret-status') {
    return await apiRequest(base, token, 'GET', `/projects/${project}/library/${item}/secret`);
  }
  if (opts.command === 'put-secret') {
    const value = await readStdin();
    if (!value) throw new LibraryError('No secret was provided on stdin.');
    return await apiRequest(base, token, 'PUT', `/projects/${project}/library/${item}/secret`, {
      kind: opts.kind,
      value,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(opts.configJson);
  } catch (e) {
    throw new LibraryError(`--config-json is not valid JSON: ${e.message}`);
  }
  const suffix =
    opts.kind === 'database'
      ? `/projects/${project}/library/${item}/db-test`
      : `/projects/${project}/library/${item}/test`;
  return await apiRequest(base, token, 'POST', suffix, { config: parsed });
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = opts.command.startsWith('upsert') ? await upsert(opts) : await accountOperation(opts);
    if (opts.format === 'human') {
      if (result.item) process.stdout.write(`${result.action} ${result.item.assetType} "${result.item.name}" (${result.item.id})\n`);
      else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof LibraryError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseArgs, apiConfig, databaseConfig, itemId, profileApiBase };
