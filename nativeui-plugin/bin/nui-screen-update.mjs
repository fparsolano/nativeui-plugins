#!/usr/bin/env node
// Import one screen and atomically replace only its matching stage.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';
import { resolveStage } from './nui-screen-extract.mjs';

class ScreenUpdateError extends Error {}
const USAGE = 'Usage: node bin/nui-screen-update.mjs <project.json> <screen.html> --stage <id|name|index> [--rename <name>] [--replace-stage-interactions] [--update-shared-library] [--dry-run]';

function parseArgs(argv) {
  let project = '';
  let html = '';
  let stage = '';
  let rename = '';
  let replaceInteractions = false;
  let updateSharedLibrary = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage') stage = argv[++i] || '';
    else if (arg === '--rename') rename = argv[++i] || '';
    else if (arg === '--replace-stage-interactions') replaceInteractions = true;
    else if (arg === '--update-shared-library') updateSharedLibrary = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '-h' || arg === '--help') throw new ScreenUpdateError(USAGE);
    else if (arg.startsWith('-')) throw new ScreenUpdateError(`Unknown flag: ${arg}\n${USAGE}`);
    else if (!project) project = arg;
    else if (!html) html = arg;
    else throw new ScreenUpdateError(`Unexpected argument: ${arg}\n${USAGE}`);
  }
  if (!project || !html || !stage) throw new ScreenUpdateError(USAGE);
  return { project, html, stage, rename, replaceInteractions, updateSharedLibrary, dryRun };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function signature(value) {
  return JSON.stringify(stableValue(value));
}

function mergeInteractions(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const key = signature(item);
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}

function replaceReferences(value, from, to) {
  if (Array.isArray(value)) return value.map((item) => replaceReferences(item, from, to));
  if (!value || typeof value !== 'object') return value === from ? to : value;
  for (const [key, item] of Object.entries(value)) value[key] = replaceReferences(item, from, to);
  return value;
}

export function mergeLibraryItems(project, importedItems, importedStage, updateSharedLibrary = false) {
  const existing = Array.isArray(project.libraryItems) ? [...project.libraryItems] : [];
  const byId = new Map(existing.map((item, index) => [item.id, { item, index }]));
  const remapped = [];
  for (const imported of importedItems || []) {
    if (!imported?.id) continue;
    const match = byId.get(imported.id);
    if (!match) {
      byId.set(imported.id, { item: imported, index: existing.length });
      existing.push(imported);
      continue;
    }
    if (JSON.stringify(match.item) === JSON.stringify(imported)) continue;
    if (updateSharedLibrary) {
      existing[match.index] = imported;
      continue;
    }
    const oldId = imported.id;
    const suffix = createHash('sha256').update(JSON.stringify(imported)).digest('hex').slice(0, 8);
    let newId = `${oldId}-screen-${suffix}`;
    let n = 2;
    while (byId.has(newId)) newId = `${oldId}-screen-${suffix}-${n++}`;
    replaceReferences(importedStage, oldId, newId);
    // Imported resources can reference one another (for example a form item
    // referring to its API definition). Keep that graph aligned with the stage.
    replaceReferences(importedItems, oldId, newId);
    existing.push(imported);
    byId.set(newId, { item: imported, index: existing.length - 1 });
    remapped.push({ from: oldId, to: newId });
  }
  return { libraryItems: existing, remapped };
}

export function mergeStage(existing, imported, opts = {}) {
  const merged = { ...existing, ...imported };
  merged.stageId = existing.stageId;
  merged.name = opts.rename || existing.name;
  for (const key of ['boardX', 'boardY', 'boardWidth', 'boardHeight']) {
    if (Object.hasOwn(existing, key)) merged[key] = existing[key];
  }
  if (!opts.replaceInteractions) {
    merged.interactions = mergeInteractions(existing.interactions, imported.interactions);
    merged.interactionSpecs = mergeInteractions(existing.interactionSpecs, imported.interactionSpecs);
  }
  return merged;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const [projectText, html] = await Promise.all([fs.readFile(opts.project, 'utf8'), fs.readFile(opts.html, 'utf8')]);
    const project = JSON.parse(projectText);
    const found = resolveStage(project, opts.stage);
    if (!found) throw new ScreenUpdateError(`No stage matched '${opts.stage}'.`);
    const config = await getConfig();
    const response = await fetch(`${config.exportServiceUrl}/export/import/html`, {
      method: 'POST',
      headers: await exportServiceHeaders(config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pages: [{ name: found.stage.name || 'Screen', html }] }),
    });
    if (response.status === 401 || response.status === 403) throw new ScreenUpdateError(exportServiceRejectedAuthMessage(config, 'Screen update'));
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new ScreenUpdateError(`Screen import failed (HTTP ${response.status}): ${text.slice(0, 600)}`);
    if (payload.errors?.length) throw new ScreenUpdateError(`Screen import reported errors:\n${payload.errors.map((item) => `  - ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`);
    const importedProject = payload.project;
    const importedStage = importedProject?.stages?.[0];
    if (!importedStage?.rootNodes?.length) throw new ScreenUpdateError('Screen import produced no stage nodes.');
    const library = mergeLibraryItems(project, importedProject.libraryItems || [], importedStage, opts.updateSharedLibrary);
    const merged = mergeStage(found.stage, importedStage, opts);
    project.stages[found.index] = merged;
    project.libraryItems = library.libraryItems;
    if (!Array.isArray(project.stages) || project.stages.some((stage) => !Array.isArray(stage.rootNodes) || !stage.rootNodes.length)) {
      throw new ScreenUpdateError('Merged project failed structural validation; nothing written.');
    }
    if (opts.dryRun) {
      process.stdout.write(JSON.stringify({ stageId: merged.stageId, name: merged.name, remappedLibraryItems: library.remapped, dryRun: true }, null, 2) + '\n');
      return;
    }
    const output = path.resolve(opts.project);
    const temporary = `${output}.nativeui-update-${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(project, null, 2) + '\n');
      const candidate = JSON.parse(await fs.readFile(temporary, 'utf8'));
      if (!Array.isArray(candidate.stages) || candidate.stages.length !== project.stages.length) {
        throw new ScreenUpdateError('Temporary project validation failed; nothing replaced.');
      }
      await fs.rename(temporary, output);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    process.stdout.write(`Updated only stage ${merged.stageId || found.index + 1} (${merged.name}) in ${output}\n`);
    if (library.remapped.length) process.stdout.write(`  Remapped ${library.remapped.length} colliding imported library item(s).\n`);
  } catch (error) {
    if (error instanceof ScreenUpdateError || error instanceof ConfigError || error instanceof AuthError) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`Unexpected error: ${error.message || error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
