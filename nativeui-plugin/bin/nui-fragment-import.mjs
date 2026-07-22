// nui-fragment-import.mjs — import ONE HTML/CSS snippet into a NodeState SUBTREE.
//
// The granular-editing forward path: regenerate one component/section instead of
// re-authoring a whole screen. Reads a snippet HTML file (a single
// `<div class="card">…</div>` etc., with an optional embedded `<style>`), POSTs it
// to <exportServiceUrl>/export/import/fragment with a fresh token, and writes the
// returned subtree as JSON: { rootNodes:[...], libraryItems:[...] }. Splice
// `rootNodes` into a stage's rootNodes (or a node's children) in your project.json,
// merge any `libraryItems`, then run nui-validate before export.
//
// Usage:
//   node bin/nui-fragment-import.mjs <snippet.html> [-o subtree.json]
//   node bin/nui-fragment-import.mjs <snippet.html> --nodes-only   # write just the rootNodes array

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';

class FragmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FragmentError';
  }
}

const USAGE =
  'Usage: node bin/nui-fragment-import.mjs <snippet.html> [-o subtree.json] [--nodes-only]';

function parseArgs(argv) {
  let snippet;
  let out = './subtree.json';
  let nodesOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new FragmentError('-o requires a path argument.');
    } else if (a === '--nodes-only') {
      nodesOnly = true;
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
  return { snippet, out, nodesOnly };
}

function countNodes(nodes) {
  let n = 0;
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    n++;
    if (Array.isArray(x.children)) x.children.forEach(walk);
    if (x.graphicNode) walk(x.graphicNode);
    if (x.clipNode) walk(x.clipNode);
  };
  (nodes || []).forEach(walk);
  return n;
}

async function main() {
  try {
    const { snippet, out, nodesOnly } = parseArgs(process.argv.slice(2));
    const config = await getConfig();

    let html;
    try {
      html = await fs.readFile(snippet, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new FragmentError(`Snippet file not found: ${snippet}`);
      throw new FragmentError(`Could not read ${snippet}: ${e.message}`);
    }
    if (!html.trim()) throw new FragmentError(`Snippet ${snippet} is empty.`);

    const url = `${config.exportServiceUrl}/export/import/fragment`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: await exportServiceHeaders(config, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ html }),
      });
    } catch (e) {
      throw new FragmentError(`Network error contacting export service: ${e.message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new FragmentError(exportServiceRejectedAuthMessage(config, 'Fragment import'));
    }

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new FragmentError(`Service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`);
    }
    if (!res.ok) {
      throw new FragmentError(`Fragment import failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
    }
    if (Array.isArray(json.errors) && json.errors.length) {
      process.stderr.write('Fragment import reported errors (nothing written):\n');
      for (const e of json.errors) process.stderr.write(`  - ${typeof e === 'string' ? e : JSON.stringify(e)}\n`);
      process.exit(1);
    }
    if (json.ok === false || !Array.isArray(json.rootNodes) || json.rootNodes.length === 0) {
      throw new FragmentError('Fragment import produced no nodes (nothing written).');
    }

    const outPath = path.resolve(out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const payload = nodesOnly
      ? json.rootNodes
      : { rootNodes: json.rootNodes, libraryItems: json.libraryItems || [] };
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2));

    process.stdout.write(
      `Imported fragment -> ${outPath}\n` +
        `  root nodes: ${json.rootNodes.length}, total nodes: ${countNodes(json.rootNodes)}, ` +
        `library items: ${(json.libraryItems || []).length}\n` +
        `  Splice rootNodes into a stage's rootNodes (or a node's children), merge libraryItems, ` +
        `then run nui-validate before export.\n`
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof FragmentError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
