#!/usr/bin/env node
// Search the generated NativeUI capability and target contract.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.resolve(BIN_DIR, '..', 'capabilities', 'nativeui-capability-catalog.json');
const USAGE = 'Usage: node bin/nui-capabilities.mjs matrix | search <term> | show <capability-or-target-id> [--target <id>] [--json|--human]';

function parseArgs(argv) {
  const command = argv.shift();
  if (!['matrix', 'search', 'show'].includes(command)) throw new Error(USAGE);
  let query = '';
  let target = '';
  let format = 'human';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') target = argv[++i] || '';
    else if (arg === '--json') format = 'json';
    else if (arg === '--human') format = 'human';
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}\n${USAGE}`);
    else if (!query) query = arg;
    else query += ` ${arg}`;
  }
  if (command !== 'matrix' && !query) throw new Error(`${command} requires a query.\n${USAGE}`);
  return { command, query, target, format };
}

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
}

function matrix(catalog) {
  return catalog.targets.map((target) => ({
    id: target.id,
    status: target.releaseStatus,
    ui: target.generatedUi,
    description: target.description,
    bestFor: target.bestFor,
    tradeoffs: target.tradeoffs,
    renderModes: target.renderModes || [],
    defaultRenderMode: target.defaultRenderMode || '',
    seam: target.writeOnceFiles.join(', '),
    run: target.runHosts.join(', '),
    release: target.releaseArtifacts.join(', '),
  }));
}

function search(catalog, raw, target) {
  const query = raw.toLowerCase();
  const declarations = [
    ...catalog.capabilities.map((item) => ({ type: 'capability', item })),
    ...catalog.kindContracts.map((item) => ({ type: 'kind', item })),
    ...catalog.transportMarkers.map((item) => ({ type: 'transport', item })),
    ...catalog.triggerContracts.map((item) => ({ type: 'trigger', item })),
    ...catalog.actionContracts.map((item) => ({ type: 'action', item })),
    ...catalog.timelinePropertyContracts.map((item) => ({ type: 'timeline', item })),
  ];
  return declarations.filter(({ item }) => JSON.stringify(item).toLowerCase().includes(query))
    .map(({ type, item }) => ({
      type,
      id: item.id || item.shortName || item.attribute,
      disposition: target ? item.targetSupport?.[target]?.disposition || 'UNMAPPED' : item.disposition || 'IMPLEMENTED',
      scopes: item.scopes,
      diagnosticCode: item.diagnosticCode,
    }));
}

function emit(value, format) {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  if (Array.isArray(value)) {
    for (const row of value) {
      process.stdout.write(Object.entries(row).map(([key, item]) => `${key}=${Array.isArray(item) ? item.join(',') : item ?? ''}`).join('  ') + '\n');
    }
  } else {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  }
}

function main() {
try {
  const opts = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  let result;
  if (opts.command === 'matrix') result = matrix(catalog);
  else if (opts.command === 'search') result = search(catalog, opts.query, opts.target);
  else result = catalog.targets.find((target) => target.id === opts.query)
    || catalog.capabilities.find((capability) => capability.id === opts.query);
  if (!result || (Array.isArray(result) && !result.length)) throw new Error(`No NativeUI capability or target matched '${opts.query}'.`);
  emit(result, opts.format);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export { matrix, search };
