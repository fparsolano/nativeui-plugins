#!/usr/bin/env node
// Export one complete stage to editable HTML without touching other stages.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';

class ScreenError extends Error {}
const USAGE = 'Usage: node bin/nui-screen-extract.mjs <project.json> --stage <id|name|1-based-index> [-o screen.html]';

function parseArgs(argv) {
  let project = '';
  let stage = '';
  let out = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage') stage = argv[++i] || '';
    else if (arg === '-o' || arg === '--output') out = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') throw new ScreenError(USAGE);
    else if (arg.startsWith('-')) throw new ScreenError(`Unknown flag: ${arg}\n${USAGE}`);
    else if (!project) project = arg;
    else throw new ScreenError(`Unexpected argument: ${arg}\n${USAGE}`);
  }
  if (!project || !stage) throw new ScreenError(USAGE);
  return { project, stage, out };
}

export function resolveStage(project, selector) {
  const stages = Array.isArray(project?.stages) ? project.stages : [];
  const numeric = Number(selector);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= stages.length) return { stage: stages[numeric - 1], index: numeric - 1 };
  const lowered = String(selector).trim().toLowerCase();
  const index = stages.findIndex((stage) => String(stage.stageId || '').toLowerCase() === lowered
    || String(stage.name || '').toLowerCase() === lowered);
  return index >= 0 ? { stage: stages[index], index } : null;
}

function slug(value) {
  return String(value || 'screen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const parsed = JSON.parse(await fs.readFile(opts.project, 'utf8'));
    const found = resolveStage(parsed, opts.stage);
    if (!found) throw new ScreenError(`No stage matched '${opts.stage}'.`);
    const config = await getConfig();
    const response = await fetch(`${config.exportServiceUrl}/export/fragment`, {
      method: 'POST',
      headers: await exportServiceHeaders(config, { 'Content-Type': 'application/json', Accept: 'text/html' }),
      body: JSON.stringify({ rootNodes: found.stage.rootNodes || [], libraryItems: parsed.libraryItems || [] }),
    });
    if (response.status === 401 || response.status === 403) throw new ScreenError(exportServiceRejectedAuthMessage(config, 'Screen extract'));
    const fragment = await response.text();
    if (!response.ok) throw new ScreenError(`Screen extract failed (HTTP ${response.status}): ${fragment.slice(0, 600)}`);
    const name = found.stage.name || found.stage.stageId || `Screen ${found.index + 1}`;
    const html = `<!doctype html>\n<html lang="en" data-nativeui-stage-id="${found.stage.stageId || ''}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title>\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
    const output = path.resolve(opts.out || `${slug(name)}.html`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, html);
    process.stdout.write(`Extracted stage ${found.stage.stageId || found.index + 1} (${name}) -> ${output}\n`);
  } catch (error) {
    if (error instanceof ScreenError || error instanceof ConfigError || error instanceof AuthError) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`Unexpected error: ${error.message || error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
