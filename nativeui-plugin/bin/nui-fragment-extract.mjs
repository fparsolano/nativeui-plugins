// nui-fragment-extract.mjs — extract one node SUBTREE from a project.json back to
// an HTML/CSS snippet (the granular-editing reverse path).
//
// Finds the node with the given --id anywhere in the project, gathers the project's
// libraryItems (so library refs in the subtree inline), POSTs
// { rootNodes:[<node>], libraryItems:[...] } to <exportServiceUrl>/export/fragment,
// and writes the returned self-contained HTML/CSS snippet. Edit the HTML, then
// re-import it with nui-fragment-import.mjs and splice it back.
//
// Usage:
//   node bin/nui-fragment-extract.mjs <project.json> --id <nodeId> [-o snippet.html]

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
  'Usage: node bin/nui-fragment-extract.mjs <project.json> --id <nodeId> [-o snippet.html]';

function parseArgs(argv) {
  let project;
  let id;
  let out;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') {
      id = argv[++i];
      if (!id) throw new FragmentError('--id requires a node id.');
    } else if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new FragmentError('-o requires a path argument.');
    } else if (a === '-h' || a === '--help') {
      throw new FragmentError(USAGE);
    } else if (a.startsWith('-')) {
      throw new FragmentError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project) {
      project = a;
    } else {
      throw new FragmentError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!project) throw new FragmentError(`Missing <project.json>.\n${USAGE}`);
  if (!id) throw new FragmentError(`Missing --id <nodeId>.\n${USAGE}`);
  if (!out) out = `./${id}.html`;
  return { project, id, out };
}

// Depth-first search for a node by id across every stage's rootNodes (and graphic/clip slots).
function findNodeById(project, id) {
  const stages = Array.isArray(project.stages) ? project.stages : [];
  let found = null;
  const walk = (n) => {
    if (found || !n || typeof n !== 'object') return;
    if (n.id === id) {
      found = n;
      return;
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
    if (n.graphicNode) walk(n.graphicNode);
    if (n.clipNode) walk(n.clipNode);
  };
  for (const st of stages) {
    (st.rootNodes || []).forEach(walk);
    if (found) break;
  }
  return found;
}

async function main() {
  try {
    const { project, id, out } = parseArgs(process.argv.slice(2));
    const config = await getConfig();

    let body;
    try {
      body = await fs.readFile(project, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new FragmentError(`Project file not found: ${project}`);
      throw new FragmentError(`Could not read ${project}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      throw new FragmentError(`${project} is not valid JSON: ${e.message}`);
    }

    const node = findNodeById(parsed, id);
    if (!node) {
      throw new FragmentError(`No node with id "${id}" found in ${path.basename(project)}.`);
    }

    const url = `${config.exportServiceUrl}/export/fragment`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: await exportServiceHeaders(config, {
          'Content-Type': 'application/json',
          Accept: 'text/html',
        }),
        body: JSON.stringify({ rootNodes: [node], libraryItems: parsed.libraryItems || [] }),
      });
    } catch (e) {
      throw new FragmentError(`Network error contacting export service: ${e.message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new FragmentError(exportServiceRejectedAuthMessage(config, 'Fragment extract'));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new FragmentError(`Fragment extract failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
    }
    if (!text.trim()) {
      throw new FragmentError('Fragment extract returned an empty snippet.');
    }

    const outPath = path.resolve(out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, text);
    process.stdout.write(
      `Extracted node "${id}" (${node.kind || 'unknown kind'}) -> ${outPath} (${text.length} bytes)\n` +
        `  Edit the HTML/CSS, then re-import with nui-fragment-import.mjs and splice it back.\n`
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
