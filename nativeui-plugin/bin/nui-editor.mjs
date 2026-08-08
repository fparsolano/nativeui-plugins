#!/usr/bin/env node
// Safe AI/editor handoff around the guarded project-sync contract.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfig } from './config.mjs';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SYNC = path.join(BIN_DIR, 'nui-project-sync.mjs');
const VALIDATE = path.join(BIN_DIR, 'nui-validate.mjs');
const USAGE = 'Usage: node bin/nui-editor.mjs handoff|resume|publish <project.json> (--name <name>|--project-id <id>) [--location <folder>] [--open] [--json|--human]';

function parseArgs(argv) {
  const command = argv.shift();
  if (!['handoff', 'resume', 'publish'].includes(command)) throw new Error(USAGE);
  let project = '';
  let name = '';
  let projectId = '';
  let location = '';
  let open = false;
  let format = 'human';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' || arg === '-n') name = argv[++i] || '';
    else if (arg === '--project-id') projectId = argv[++i] || '';
    else if (arg === '--location') location = argv[++i] || '';
    else if (arg === '--open') open = true;
    else if (arg === '--json') format = 'json';
    else if (arg === '--human') format = 'human';
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    else if (!project) project = arg;
    else throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
  }
  if (!project || (!name && !projectId) || ((command === 'handoff' || command === 'publish') && !name)) throw new Error(USAGE);
  return { command, project, name, projectId, location, open, format };
}

function syncArgs(action, opts, format = 'json') {
  const args = [SYNC, action, opts.project];
  if (opts.projectId) args.push('--project-id', opts.projectId);
  if (opts.name) args.push('--name', opts.name);
  if (opts.location) args.push('--location', opts.location);
  args.push(format === 'json' ? '--json' : '--human');
  return args;
}

function runSync(action, opts, format = 'json') {
  const result = spawnSync(process.execPath, syncArgs(action, opts, format), { encoding: 'utf8', env: process.env });
  return { ...result, payload: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

export function decideResume(report) {
  if (report.conflict) return 'conflict';
  if (report.inSync) return 'in-sync';
  if (report.cloudChanged && !report.localChanged) return 'pull';
  if (report.localChanged && !report.cloudChanged) return 'local-only';
  return 'no-change';
}

function editorUrl(config) {
  const override = (process.env.NATIVEUI_WEB_EDITOR_URL || '').replace(/\/+$/, '');
  if (override) return override;
  const url = new URL(config.exportServiceUrl);
  return `${url.protocol}//${url.host.startsWith('webapp.') ? url.host : `webapp.${url.host}`}`;
}

function openUrl(url) {
  const command = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  return spawnSync(command[0], command[1], { stdio: 'ignore' }).status === 0;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const config = await getConfig();
    const url = editorUrl(config);
    let result;
    if (opts.command === 'resume') {
      const status = runSync('status', opts);
      if (status.status === 2 || status.payload?.conflict) {
        process.stderr.write('Conflict: local and cloud both changed; resolve or save a new draft before continuing.\n');
        process.exit(2);
      }
      if (status.status !== 0) throw new Error(status.stderr.trim() || 'Could not inspect editor sync status.');
      const decision = decideResume(status.payload);
      if (decision === 'pull') {
        result = runSync('pull', opts);
        if (result.status !== 0) throw new Error(result.stderr.trim() || 'Cloud pull failed.');
      } else result = { payload: { action: decision, ...status.payload } };
    } else {
      const validation = spawnSync(process.execPath, [VALIDATE, opts.project, '--structural'], {
        encoding: 'utf8', env: process.env,
      });
      if (validation.status !== 0) {
        throw new Error(validation.stderr.trim() || 'Project validation failed before editor push.');
      }
      result = runSync('push', opts);
      if (result.status !== 0) {
        process.stderr.write(result.stderr);
        process.exit(result.status === 2 ? 2 : 1);
      }
    }
    const output = { command: opts.command, project: path.resolve(opts.project), name: opts.name || result.payload?.name, editorUrl: url, result: result.payload };
    if (opts.open) output.opened = openUrl(url);
    if (opts.format === 'json') process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    else process.stdout.write(`${opts.command}: ${output.name || opts.projectId}\n  editor: ${url}\n  sync: ${output.result?.action || 'complete'}\n`);
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
