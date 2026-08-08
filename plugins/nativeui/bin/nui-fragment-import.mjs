// nui-fragment-import.mjs — import ONE HTML/CSS snippet into a NodeState SUBTREE.
//
// The granular-editing forward path: regenerate one component/section instead of
// re-authoring a whole screen. Reads a snippet HTML file (a single
// `<div class="card">…</div>` etc., with an optional embedded `<style>`), POSTs it
// to <exportServiceUrl>/export/import/fragment with a fresh token, and writes the
// returned subtree as JSON, or atomically splices it into one existing project node.
//
// Usage:
//   node bin/nui-fragment-import.mjs <snippet.html> [-o subtree.json]
//   node bin/nui-fragment-import.mjs <snippet.html> --nodes-only   # write just the rootNodes array
//   node bin/nui-fragment-import.mjs <snippet.html> --project project.json --replace node-id
//   node bin/nui-fragment-import.mjs <snippet.html> --project project.json --append-to node-id

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';
import { nodeLocations, spliceFragment } from '../lib/fragment-splice.mjs';
import { writeProjectAtomically } from '../lib/project-update.mjs';

export class FragmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FragmentError';
  }
}

const USAGE =
  'Usage: node bin/nui-fragment-import.mjs <snippet.html> [-o subtree.json] [--nodes-only]\n' +
  '   or: node bin/nui-fragment-import.mjs <snippet.html> --project project.json ' +
  '(--replace node-id | --append-to node-id) [--recipe recipe.json] ' +
  '[--update-shared-library] [--dry-run]';

export function parseArgs(argv) {
  let snippet;
  let out = './subtree.json';
  let nodesOnly = false;
  let project = '';
  let replace = '';
  let appendTo = '';
  let recipe = '';
  let updateSharedLibrary = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new FragmentError('-o requires a path argument.');
    } else if (a === '--nodes-only') {
      nodesOnly = true;
    } else if (a === '--project') {
      project = argv[++i] || '';
      if (!project) throw new FragmentError('--project requires a path argument.');
    } else if (a === '--replace') {
      replace = argv[++i] || '';
      if (!replace) throw new FragmentError('--replace requires a node id.');
    } else if (a === '--append-to') {
      appendTo = argv[++i] || '';
      if (!appendTo) throw new FragmentError('--append-to requires a node id.');
    } else if (a === '--recipe') {
      recipe = argv[++i] || '';
      if (!recipe) throw new FragmentError('--recipe requires a path argument.');
    } else if (a === '--update-shared-library') {
      updateSharedLibrary = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '-h' || a === '--help') {
      throw new FragmentError(USAGE);
    } else if (a.startsWith('-')) {
      throw new FragmentError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!snippet) {
      snippet = a;
    } else {
      throw new FragmentError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!snippet) throw new FragmentError(`Missing <snippet.html>.\n${USAGE}`);
  if (project && Boolean(replace) === Boolean(appendTo)) {
    throw new FragmentError(
      'With --project, choose exactly one of --replace or --append-to.'
    );
  }
  if (!project && (replace || appendTo || recipe || updateSharedLibrary || dryRun)) {
    throw new FragmentError(
      '--replace, --append-to, --recipe, --update-shared-library and --dry-run require --project.'
    );
  }
  if (project && nodesOnly) {
    throw new FragmentError('--nodes-only cannot be combined with --project.');
  }
  return {
    snippet,
    out,
    nodesOnly,
    project,
    replace,
    appendTo,
    recipe,
    updateSharedLibrary,
    dryRun,
  };
}

export function countNodes(nodes) {
  let n = 0;
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    n++;
    if (Array.isArray(x.children)) x.children.forEach(walk);
    if (Array.isArray(x.skinSubcomponents)) x.skinSubcomponents.forEach(walk);
    if (x.graphicNode) walk(x.graphicNode);
    if (x.clipNode) walk(x.clipNode);
  };
  (nodes || []).forEach(walk);
  return n;
}

function countLibraryNodes(items) {
  return (items || []).reduce(
    (total, item) => total + countNodes(item?.rootNode ? [item.rootNode] : []),
    0
  );
}

function fragmentEnvelope(json) {
  return {
    rootNodes: json.rootNodes,
    libraryItems: json.libraryItems || [],
    embeddedFontFaces: json.embeddedFontFaces || [],
  };
}

async function requestFragmentImport(config, html, label = 'Fragment import') {
  const url = `${config.exportServiceUrl}/export/import/fragment`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: await exportServiceHeaders(config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ html }),
    });
  } catch (error) {
    throw new FragmentError(`Network error contacting export service: ${error.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new FragmentError(exportServiceRejectedAuthMessage(config, label));
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new FragmentError(`Service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new FragmentError(`${label} failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new FragmentError(
      `${label} reported errors (nothing written):\n` +
        json.errors
          .map((error) => `  - ${typeof error === 'string' ? error : JSON.stringify(error)}`)
          .join('\n')
    );
  }
  if (json.ok === false || !Array.isArray(json.rootNodes) || json.rootNodes.length === 0) {
    throw new FragmentError(`${label} produced no nodes (nothing written).`);
  }
  return json;
}

export function resolveNoOpBaselineTarget(project, targetId) {
  const matches = nodeLocations(project, targetId, true);
  if (matches.length !== 1) {
    throw new FragmentError(
      `Shared fragment target "${targetId}" must resolve to exactly one node; found ${matches.length}.`
    );
  }
  const target = matches[0];
  if (target.scope === 'library') {
    const item = project.libraryItems?.[target.itemIndex];
    if (!item?.id || !item.rootNode) {
      throw new FragmentError(`Direct Library target "${targetId}" has no owning Library item.`);
    }
    const sameIdItems = (project.libraryItems || []).filter((candidate) => candidate?.id === item.id);
    if (sameIdItems.length !== 1) {
      throw new FragmentError(
        `Direct Library target "${targetId}" has ${sameIdItems.length} owning items named "${item.id}".`
      );
    }
    if (target.node !== item.rootNode) {
      throw new FragmentError(
        `Cannot build a complete authored baseline for nested direct Library target "${targetId}"; ` +
          `replace the owning root "${item.rootNode.id}" instead.`
      );
    }
    if (item.assetType && item.assetType !== 'node') {
      throw new FragmentError(
        `Direct Library target "${targetId}" belongs to non-node item "${item.id}".`
      );
    }
    const rootNode = structuredClone(item.rootNode);
    rootNode.libraryItemId = item.id;
    rootNode.libraryReference = true;
    rootNode.children = [];
    return { libraryItemId: item.id, rootNode };
  }
  if (!target.node?.libraryItemId) {
    return { libraryItemId: null, rootNode: structuredClone(target.node) };
  }
  const items = (project.libraryItems || [])
    .filter((item) => item?.id === target.node.libraryItemId);
  if (items.length !== 1) {
    throw new FragmentError(
      `Shared fragment target "${targetId}" requires exactly one Library item ` +
        `"${target.node.libraryItemId}"; found ${items.length}.`
    );
  }
  return { libraryItemId: target.node.libraryItemId, rootNode: target.node };
}

async function requestNoOpBaseline(config, project, targetId) {
  const target = resolveNoOpBaselineTarget(project, targetId);
  if (!target) return null;
  const url = `${config.exportServiceUrl}/export/fragment`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: await exportServiceHeaders(config, {
        'Content-Type': 'application/json',
        Accept: 'text/html',
      }),
      body: JSON.stringify({
        rootNodes: [target.rootNode],
        libraryItems: project.libraryItems || [],
      }),
    });
  } catch (error) {
    throw new FragmentError(`Network error building fragment baseline: ${error.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new FragmentError(exportServiceRejectedAuthMessage(config, 'Fragment baseline export'));
  }
  const baselineHtml = await res.text();
  if (!res.ok) {
    throw new FragmentError(
      `Fragment baseline export failed (HTTP ${res.status}): ${baselineHtml.slice(0, 600)}`
    );
  }
  if (!baselineHtml.trim()) {
    throw new FragmentError('Fragment baseline export returned empty HTML.');
  }
  return fragmentEnvelope(
    await requestFragmentImport(config, baselineHtml, 'Fragment baseline import')
  );
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { snippet, out, nodesOnly } = options;
    const config = await getConfig();

    let html;
    try {
      html = await fs.readFile(snippet, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new FragmentError(`Snippet file not found: ${snippet}`);
      throw new FragmentError(`Could not read ${snippet}: ${e.message}`);
    }
    if (!html.trim()) throw new FragmentError(`Snippet ${snippet} is empty.`);

    const json = await requestFragmentImport(config, html);
    const fragment = fragmentEnvelope(json);
    if (options.project) {
      let project;
      try {
        project = JSON.parse(await fs.readFile(options.project, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new FragmentError(`Project file not found: ${options.project}`);
        }
        throw new FragmentError(`Could not read project ${options.project}: ${error.message}`);
      }
      let recipe = {};
      if (options.recipe) {
        try {
          recipe = JSON.parse(await fs.readFile(options.recipe, 'utf8'));
        } catch (error) {
          if (error.code === 'ENOENT') {
            throw new FragmentError(`Recipe file not found: ${options.recipe}`);
          }
          throw new FragmentError(`Could not read recipe ${options.recipe}: ${error.message}`);
        }
      }
      let result;
      try {
        const baselineFragment = options.replace
          ? await requestNoOpBaseline(config, project, options.replace)
          : null;
        result = spliceFragment(project, fragment, {
          replace: options.replace,
          appendTo: options.appendTo,
          recipe,
          updateSharedLibrary: options.updateSharedLibrary,
          baselineFragment,
        });
      } catch (error) {
        throw new FragmentError(`Fragment splice failed: ${error.message}`);
      }
      if (options.dryRun) {
        process.stdout.write(JSON.stringify({ ...result.report, dryRun: true }, null, 2) + '\n');
        return;
      }
      const output = await writeProjectAtomically(
        options.project,
        result.project,
        'nativeui-fragment'
      );
      const operation = result.report.operation === 'replace' ? 'replaced' : 'appended';
      process.stdout.write(
        `Imported and ${operation} fragment at ${result.report.targetId} in ${output}\n` +
          `  root nodes: ${result.report.rootNodeCount}, stage nodes: ${countNodes(json.rootNodes)}, ` +
          `library items: ${(json.libraryItems || []).length}, ` +
          `library nodes: ${countLibraryNodes(json.libraryItems)}\n` +
          `  canonical style remaps: ${result.report.canonicalStyleRemaps.length}, ` +
          `collision remaps: ${result.report.collidingLibraryRemaps.length}, ` +
          `authored baseline: ${result.report.authoredDeltaBaselineApplied ? 'applied' : 'not needed'}\n`
      );
      return;
    }

    const outPath = path.resolve(out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const payload = nodesOnly ? json.rootNodes : fragment;
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
    process.stdout.write(
      `Imported fragment -> ${outPath}\n` +
        `  root nodes: ${json.rootNodes.length}, stage nodes: ${countNodes(json.rootNodes)}, ` +
        `library items: ${(json.libraryItems || []).length}, ` +
        `library nodes: ${countLibraryNodes(json.libraryItems)}\n`
    );
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof FragmentError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
