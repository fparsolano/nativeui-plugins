import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.mjs';
import { exportServiceHeaders } from './auth.mjs';
import { ErrorCode, ServiceError } from './errors.mjs';

function pageName(file) { return path.basename(file).replace(/\.[^.]+$/, '') || path.basename(file); }
function summarize(project) {
  const stages = Array.isArray(project?.stages) ? project.stages : Array.isArray(project?.pages) ? project.pages : [];
  let nodes = 0;
  const walk = (node) => { if (!node || typeof node !== 'object') return; nodes++; for (const child of node.children || node.nodes || []) walk(child); };
  for (const stage of stages) for (const root of stage.root ? [stage.root] : stage.children || stage.nodes || []) walk(root);
  return { stages: stages.length, nodes };
}

export async function importHtmlToFile({ htmlFiles, outPath = './project.json' }) {
  if (!Array.isArray(htmlFiles) || !htmlFiles.length) throw new ServiceError(ErrorCode.INVALID_PROJECT, 'htmlFiles must contain at least one HTML file.');
  const seen = new Set();
  const pages = [];
  for (const file of htmlFiles) {
    let html;
    try { html = await fs.readFile(file, 'utf8'); } catch (error) { throw new ServiceError(ErrorCode.INVALID_PROJECT, `Could not read HTML file ${file}: ${error.message}`); }
    const base = pageName(file);
    let name = base;
    for (let index = 2; seen.has(name); index++) name = `${base}-${index}`;
    seen.add(name);
    pages.push({ name, html });
  }
  const config = await getConfig();
  let response;
  try {
    response = await fetch(`${config.exportServiceUrl}/export/import/html`, { method: 'POST', headers: await exportServiceHeaders(config, { 'Content-Type': 'application/json' }), body: JSON.stringify({ pages }) });
  } catch (error) { throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Network error contacting import service: ${error.message}`); }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Import service returned non-JSON (HTTP ${response.status}).`); }
  if (response.status === 401 || response.status === 403) throw new ServiceError(ErrorCode.NOT_LOGGED_IN, 'Import was rejected by the export service.', 'Call nativeui_login_start and approve the sign-in in your browser.');
  if (!response.ok || payload.ok === false || payload.errors?.length || !payload.project) throw new ServiceError(ErrorCode.INVALID_PROJECT, payload.message || payload.errors?.map(String).join('; ') || `Import failed (HTTP ${response.status}).`);
  const resolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(payload.project, null, 2));
  return { outPath: resolved, pages: pages.length, ...summarize(payload.project) };
}
