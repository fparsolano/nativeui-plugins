#!/usr/bin/env node
// nui-responsive-audit.mjs - fail-closed responsive audit for NativeUI inputs.
//
// Accepts HTML/CSS files or project.json and reports breakpoints/divisions,
// semantic responsive fields, fixed-width smells, overflow risks, and target
// coverage. By default, it exits non-zero when no responsive path is detected.
// Pass --allow-static for intentionally fixed/static designs.
//
// Usage:
//   node bin/nui-responsive-audit.mjs <file.html|project.json...> [-o report.json] [--allow-static]

import { promises as fs } from 'node:fs';
import path from 'node:path';

class ResponsiveAuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResponsiveAuditError';
  }
}

const USAGE = 'Usage: node bin/nui-responsive-audit.mjs <html|css|project.json...> [-o report.json] [--allow-static]';
const TARGETS = [
  { name: 'mobile', width: 390 },
  { name: 'phone-base', width: 412 },
  { name: 'tablet', width: 768 },
  { name: 'desktop', width: 1024 },
];

function parseArgs(argv) {
  const inputs = [];
  let out = '';
  let allowStatic = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new ResponsiveAuditError('-o requires a path argument.');
    } else if (a === '--allow-static') {
      allowStatic = true;
    } else if (a === '-h' || a === '--help') {
      throw new ResponsiveAuditError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ResponsiveAuditError(`Unknown flag: ${a}\n${USAGE}`);
    } else {
      inputs.push(a);
    }
  }
  if (!inputs.length) throw new ResponsiveAuditError(`No inputs given.\n${USAGE}`);
  return { inputs, out, allowStatic };
}

function unique(values) {
  return [...new Set(values.filter((v) => v !== undefined && v !== null && String(v).trim() !== ''))];
}

function extractMediaQueries(text) {
  const queries = [];
  const breakpoints = [];
  const re = /@media\s*([^{]+)\{/gi;
  let m;
  while ((m = re.exec(text))) {
    const condition = m[1].trim().replace(/\s+/g, ' ');
    queries.push(condition);
    for (const n of condition.match(/\b\d+(?:\.\d+)?px\b/g) || []) {
      breakpoints.push(Number(n.replace('px', '')));
    }
  }
  return { queries: unique(queries), breakpoints: unique(breakpoints).sort((a, b) => a - b) };
}

function lineCol(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function cssSignals(text) {
  const media = extractMediaQueries(text);
  const fixedWidthSmells = [];
  const fixedRe = /\b(width|min-width|max-width)\s*:\s*(\d+(?:\.\d+)?)px\b/gi;
  let m;
  while ((m = fixedRe.exec(text))) {
    const value = Number(m[2]);
    if (value >= 320) {
      fixedWidthSmells.push({
        property: m[1],
        value,
        ...lineCol(text, m.index),
        snippet: text.slice(Math.max(0, m.index - 30), Math.min(text.length, m.index + 80)).replace(/\s+/g, ' '),
      });
    }
  }
  const overflowRisks = [];
  const riskPatterns = [
    { code: 'nowrap', re: /\bwhite-space\s*:\s*nowrap\b/gi },
    { code: 'absolute-fixed', re: /\bposition\s*:\s*absolute\b[\s\S]{0,180}\bwidth\s*:\s*\d+(?:\.\d+)?px\b/gi },
    { code: 'body-fixed-412', re: /\bbody\b[\s\S]{0,160}\bwidth\s*:\s*412px\b/gi },
    { code: 'overflow-hidden', re: /\boverflow\s*:\s*hidden\b/gi },
  ];
  for (const p of riskPatterns) {
    let r;
    while ((r = p.re.exec(text))) {
      overflowRisks.push({ code: p.code, ...lineCol(text, r.index), snippet: r[0].replace(/\s+/g, ' ').slice(0, 160) });
    }
  }
  const flexibleSignals = {
    flex: /\bdisplay\s*:\s*flex\b/i.test(text),
    grid: /\bdisplay\s*:\s*grid\b/i.test(text),
    percent: /\b(?:width|height|left|right|top|bottom|gap|padding|margin)\s*:\s*[^;]*%/i.test(text),
    fr: /\b\d*(?:\.\d+)?fr\b/i.test(text),
    viewportUnits: /\b\d+(?:\.\d+)?v(?:w|h|min|max)\b/i.test(text),
    math: /\b(?:calc|min|max|clamp)\s*\(/i.test(text),
    flexGrow: /\bflex(?:-grow)?\s*:\s*(?:[1-9]|\d+\.\d+)/i.test(text),
  };
  return { ...media, fixedWidthSmells, overflowRisks, flexibleSignals };
}

function coverageFromBreakpoints(breakpoints, hasFlexiblePath) {
  return TARGETS.map((t) => ({
    ...t,
    covered: t.width <= 412 || hasFlexiblePath || breakpoints.some((bp) => Math.abs(bp - t.width) <= 80 || bp <= t.width),
  }));
}

async function analyzeHtmlFile(file) {
  const text = await fs.readFile(file, 'utf8').catch((e) => {
    throw new ResponsiveAuditError(e.code === 'ENOENT' ? `Input not found: ${file}` : `Could not read ${file}: ${e.message}`);
  });
  const sig = cssSignals(text);
  const flexibleCount = Object.values(sig.flexibleSignals).filter(Boolean).length;
  const hasResponsivePath = sig.breakpoints.length > 0 || flexibleCount >= 2;
  const warnings = [];
  if (!sig.breakpoints.length) warnings.push('No @media width breakpoints detected.');
  if (flexibleCount < 2) warnings.push('Few flexible layout signals detected; prefer %, fr, flex-grow, grid, viewport units, or calc/clamp.');
  if (sig.fixedWidthSmells.length) warnings.push(`${sig.fixedWidthSmells.length} fixed width smell(s) may block reflow.`);
  if (sig.overflowRisks.length) warnings.push(`${sig.overflowRisks.length} overflow risk(s) detected.`);
  return {
    input: path.resolve(file),
    kind: 'html-css',
    ok: hasResponsivePath,
    hasResponsivePath,
    breakpoints: sig.breakpoints,
    mediaQueries: sig.queries,
    flexibleSignals: sig.flexibleSignals,
    fixedWidthSmells: sig.fixedWidthSmells,
    overflowRisks: sig.overflowRisks,
    targetCoverage: coverageFromBreakpoints(sig.breakpoints, flexibleCount >= 2),
    warnings,
  };
}

function walkNodes(nodes, fn) {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    fn(n);
    if (Array.isArray(n.children)) n.children.forEach(visit);
    if (n.graphicNode) visit(n.graphicNode);
    if (n.clipNode) visit(n.clipNode);
  };
  for (const n of Array.isArray(nodes) ? nodes : []) visit(n);
}

function countSemanticFields(node) {
  let count = 0;
  for (const k of Object.keys(node)) {
    if (/^semantic[A-Z]/.test(k) || k.startsWith('responsive') || k === 'divisionOverrides') count++;
  }
  return count;
}

async function analyzeProjectFile(file) {
  const text = await fs.readFile(file, 'utf8').catch((e) => {
    throw new ResponsiveAuditError(e.code === 'ENOENT' ? `Input not found: ${file}` : `Could not read ${file}: ${e.message}`);
  });
  let project;
  try {
    project = JSON.parse(text);
  } catch {
    throw new ResponsiveAuditError(`Project input is not valid JSON: ${file}`);
  }
  if (!project || typeof project !== 'object' || !Array.isArray(project.stages)) {
    throw new ResponsiveAuditError(`JSON input is not a NativeUI project (missing stages[]): ${file}`);
  }
  const stages = [];
  let totalDivisions = 0;
  let semanticFieldCount = 0;
  let overrideNodes = 0;
  const fixedWidthSmells = [];
  for (const [index, st] of project.stages.entries()) {
    const divisions = Array.isArray(st.divisions) ? st.divisions : [];
    totalDivisions += divisions.length;
    const stage = {
      index,
      name: st.name || st.stageId || `stage-${index + 1}`,
      stageWidth: st.stageWidth,
      stageHeight: st.stageHeight,
      responsiveLayoutVersion: st.responsiveLayoutVersion || project.responsiveLayoutVersion || null,
      divisions: divisions.map((d) => ({
        id: d.id || d.divisionId || d.name,
        name: d.name,
        minWidth: d.minWidth,
        maxWidth: d.maxWidth,
        width: d.width,
      })),
      semanticNodes: 0,
      overrideNodes: 0,
    };
    walkNodes(st.rootNodes, (node) => {
      const fields = countSemanticFields(node);
      if (fields) {
        semanticFieldCount += fields;
        stage.semanticNodes++;
      }
      if (node.divisionOverrides && typeof node.divisionOverrides === 'object') {
        overrideNodes++;
        stage.overrideNodes++;
      }
      for (const f of ['width', 'prefWidth', 'minWidth', 'maxWidth']) {
        if (typeof node[f] === 'number' && node[f] >= 320) {
          fixedWidthSmells.push({ stage: stage.name, nodeId: node.id, field: f, value: node[f] });
        }
      }
    });
    stages.push(stage);
  }
  const hasResponsivePath =
    totalDivisions > 0 ||
    semanticFieldCount > 0 ||
    overrideNodes > 0 ||
    stages.some((s) => Number(s.responsiveLayoutVersion) >= 1);
  const warnings = [];
  if (!totalDivisions) warnings.push('No stage divisions detected.');
  if (!semanticFieldCount) warnings.push('No semantic responsive node fields detected.');
  if (fixedWidthSmells.length) warnings.push(`${fixedWidthSmells.length} fixed numeric width(s) >= 320px detected.`);
  return {
    input: path.resolve(file),
    kind: 'project-json',
    ok: hasResponsivePath,
    hasResponsivePath,
    stages,
    divisionCount: totalDivisions,
    semanticFieldCount,
    overrideNodes,
    fixedWidthSmells: fixedWidthSmells.slice(0, 80),
    targetCoverage: coverageFromBreakpoints(
      stages.flatMap((s) => s.divisions.flatMap((d) => [d.minWidth, d.maxWidth, d.width]).filter((v) => typeof v === 'number')),
      hasResponsivePath
    ),
    warnings,
  };
}

async function analyzeInput(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm' || ext === '.css' || ext === '.scss' || ext === '.sass') {
    return analyzeHtmlFile(file);
  }
  if (ext === '.json') return analyzeProjectFile(file);
  throw new ResponsiveAuditError(`Unsupported input type for responsive audit: ${file}`);
}

async function main() {
  try {
    const { inputs, out, allowStatic } = parseArgs(process.argv.slice(2));
    const items = [];
    for (const input of inputs) items.push(await analyzeInput(input));
    const failing = items.filter((i) => !i.ok);
    const report = {
      version: 1,
      createdAt: new Date().toISOString(),
      tool: 'nui-responsive-audit',
      allowStatic,
      ok: allowStatic || failing.length === 0,
      targets: TARGETS,
      inputs: items,
      summary: {
        inputCount: items.length,
        failing: failing.length,
        breakpoints: unique(items.flatMap((i) => i.breakpoints || [])).sort((a, b) => a - b),
        divisionCount: items.reduce((sum, i) => sum + (i.divisionCount || 0), 0),
      },
    };
    const payload = JSON.stringify(report, null, 2);
    if (out) {
      const outPath = path.resolve(out);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, payload);
      process.stdout.write(`Wrote responsive audit -> ${outPath}\n`);
    } else {
      process.stdout.write(payload + '\n');
    }
    if (!report.ok) {
      process.stderr.write('Responsive audit failed: no responsive path detected for one or more inputs. Pass --allow-static only for intentionally fixed designs.\n');
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof ResponsiveAuditError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
