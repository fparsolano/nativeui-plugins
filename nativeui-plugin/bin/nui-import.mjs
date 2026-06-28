// nui-import.mjs — import one or more HTML files into a NativeUI project.
//
// Builds { pages: [ { name:<file basename>, html:<contents> }, ... ] } and POSTs
// to <exportServiceUrl>/export/import/html with a fresh token. On success writes
// the returned project to -o (default ./project.json) and prints a summary. If
// the service returns errors[], prints them and exits non-zero WITHOUT writing a
// broken project.
//
// Usage:
//   node bin/nui-import.mjs page1.html [page2.html ...] [-o project.json]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

function parseArgs(argv) {
  const htmlFiles = [];
  let out = './project.json';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new ImportError('-o requires a path argument.');
    } else if (a === '-h' || a === '--help') {
      throw new ImportError(
        'Usage: node bin/nui-import.mjs <file.html> [more.html ...] [-o project.json]'
      );
    } else if (a.startsWith('-')) {
      throw new ImportError(`Unknown flag: ${a}`);
    } else {
      htmlFiles.push(a);
    }
  }
  if (!htmlFiles.length) {
    throw new ImportError(
      'No HTML files given.\n  Usage: node bin/nui-import.mjs <file.html> [...] [-o project.json]'
    );
  }
  return { htmlFiles, out };
}

function pageNameFor(file) {
  return path.basename(file).replace(/\.[^.]+$/, '') || path.basename(file);
}

async function buildPages(htmlFiles) {
  const pages = [];
  const seen = new Set();
  for (const file of htmlFiles) {
    let html;
    try {
      html = await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new ImportError(`HTML file not found: ${file}`);
      throw new ImportError(`Could not read ${file}: ${e.message}`);
    }
    let name = pageNameFor(file);
    // De-dup page names so the project doesn't collide on identical basenames.
    let unique = name;
    let n = 2;
    while (seen.has(unique)) unique = `${name}-${n++}`;
    seen.add(unique);
    pages.push({ name: unique, html });
  }
  return pages;
}

function summarize(project) {
  // The project shape can vary; count stages/nodes defensively.
  const stages = Array.isArray(project.stages)
    ? project.stages
    : Array.isArray(project.pages)
      ? project.pages
      : [];
  let nodeCount = 0;
  const countNodes = (n) => {
    if (!n || typeof n !== 'object') return;
    nodeCount++;
    const kids = n.children || n.nodes || [];
    if (Array.isArray(kids)) kids.forEach(countNodes);
  };
  for (const st of stages) {
    const roots = st.root ? [st.root] : st.children || st.nodes || [];
    if (Array.isArray(roots)) roots.forEach(countNodes);
    else countNodes(roots);
  }
  return { stages: stages.length, nodes: nodeCount };
}

async function main() {
  try {
    const { htmlFiles, out } = parseArgs(process.argv.slice(2));
    const config = await getConfig();
    const pages = await buildPages(htmlFiles);

    const url = `${config.exportServiceUrl}/export/import/html`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: await exportServiceHeaders(config, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ pages }),
      });
    } catch (e) {
      throw new ImportError(`Network error contacting export service: ${e.message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ImportError(exportServiceRejectedAuthMessage(config, 'Import'));
    }

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ImportError(`Import service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`);
    }

    if (!res.ok) {
      throw new ImportError(`Import failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
    }

    if (Array.isArray(json.errors) && json.errors.length) {
      process.stderr.write('Import reported errors (project NOT written):\n');
      for (const e of json.errors) {
        process.stderr.write(`  - ${typeof e === 'string' ? e : JSON.stringify(e)}\n`);
      }
      process.exit(1);
    }

    if (json.ok === false) {
      throw new ImportError(`Import failed: ${json.message || 'unknown error'} (project NOT written)`);
    }

    const project = json.project;
    if (!project || typeof project !== 'object') {
      throw new ImportError('Import succeeded but returned no project body (nothing written).');
    }

    const outPath = path.resolve(out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(project, null, 2));

    const { stages, nodes } = summarize(project);
    process.stdout.write(
      `Imported ${pages.length} page(s) -> ${outPath}\n` +
        `  stages: ${stages}, nodes: ${nodes}\n`
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof ImportError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
