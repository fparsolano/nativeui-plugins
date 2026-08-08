#!/usr/bin/env node
// Import one screen and atomically replace only its matching stage.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';
import { resolveStage } from './nui-screen-extract.mjs';
import {
  mergeInteractions,
  mergeLibraryItems,
  validateProjectStructure,
  writeProjectAtomically,
} from '../lib/project-update.mjs';

export { mergeLibraryItems } from '../lib/project-update.mjs';

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
    try {
      validateProjectStructure(project);
    } catch (error) {
      throw new ScreenUpdateError(`Merged project failed structural validation: ${error.message}`);
    }
    if (opts.dryRun) {
      process.stdout.write(JSON.stringify({ stageId: merged.stageId, name: merged.name, remappedLibraryItems: library.remapped, dryRun: true }, null, 2) + '\n');
      return;
    }
    const output = await writeProjectAtomically(opts.project, project);
    process.stdout.write(`Updated only stage ${merged.stageId || found.index + 1} (${merged.name}) in ${output}\n`);
    if (library.remapped.length) process.stdout.write(`  Remapped ${library.remapped.length} colliding imported library item(s).\n`);
  } catch (error) {
    if (error instanceof ScreenUpdateError || error instanceof ConfigError || error instanceof AuthError) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`Unexpected error: ${error.message || error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
