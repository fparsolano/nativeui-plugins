#!/usr/bin/env node
// nui-intake.mjs - normalize messy user inputs into a NativeUI design-source bundle.
//
// Dependency-free, conservative, and local-first. It reads files/folders/URLs and
// emits a JSON bundle with provenance, responsive clues, assets, source-code
// summaries, Figma metadata when available, and explicit gaps for anything the
// agent still needs to inspect. It never fabricates visual facts.
//
// Usage:
//   node bin/nui-intake.mjs <input...> [-o nativeui-intake.json] [--prompt "..."]
//
// Inputs may be HTML/CSS, PDFs, images, source folders, Figma URLs/JSON, or plain
// URLs. Figma API fetch is optional and only runs when FIGMA_TOKEN or
// NATIVEUI_FIGMA_TOKEN is present.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

class IntakeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntakeError';
  }
}

const USAGE = 'Usage: node bin/nui-intake.mjs <input...> [-o nativeui-intake.json] [--prompt "..."]';
const DEFAULT_TARGETS = [360, 390, 412, 768, 1024, 1280];
const MAX_TEXT = 24000;
const MAX_DIR_FILES = 300;
const MAX_FIGMA_NODES = 120;
const SOURCE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass',
  '.kt', '.kts', '.swift', '.java', '.xml', '.json', '.md',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function parseArgs(argv) {
  const inputs = [];
  let out = 'nativeui-intake.json';
  let prompt = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new IntakeError('-o requires a path argument.');
    } else if (a === '--prompt') {
      prompt = argv[++i] || '';
      if (!prompt.trim()) throw new IntakeError('--prompt requires a non-empty string.');
    } else if (a === '-h' || a === '--help') {
      throw new IntakeError(USAGE);
    } else if (a.startsWith('-')) {
      throw new IntakeError(`Unknown flag: ${a}\n${USAGE}`);
    } else {
      inputs.push(a);
    }
  }
  if (!inputs.length && !prompt.trim()) {
    throw new IntakeError(`No inputs or prompt given.\n${USAGE}`);
  }
  return { inputs, out, prompt };
}

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

function truncate(text, max = MAX_TEXT) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]` : s;
}

function unique(values) {
  return [...new Set(values.filter((v) => v !== undefined && v !== null && String(v).trim() !== ''))];
}

function confidence(score, reasons = []) {
  return { score: Math.max(0, Math.min(1, Number(score.toFixed(2)))), reasons };
}

function extractMediaQueries(text) {
  const queries = [];
  const breakpoints = [];
  const re = /@media\s*([^{]+)\{/gi;
  let m;
  while ((m = re.exec(text))) {
    const condition = m[1].trim().replace(/\s+/g, ' ');
    queries.push(condition);
    const nums = condition.match(/\b\d+(?:\.\d+)?px\b/g) || [];
    for (const n of nums) breakpoints.push(Number(n.replace('px', '')));
  }
  return { queries: unique(queries), breakpoints: unique(breakpoints).sort((a, b) => a - b) };
}

function extractCssSignals(text) {
  const { queries, breakpoints } = extractMediaQueries(text);
  const fixedWidths = [];
  const widthRe = /\b(?:width|min-width|max-width|height|min-height|max-height)\s*:\s*(\d+(?:\.\d+)?)px\b/gi;
  let m;
  while ((m = widthRe.exec(text))) {
    const value = Number(m[1]);
    if (value >= 320) fixedWidths.push({ value, snippet: text.slice(Math.max(0, m.index - 30), m.index + 60).replace(/\s+/g, ' ') });
  }
  return {
    mediaQueries: queries,
    breakpoints,
    usesFlex: /\bdisplay\s*:\s*flex\b/i.test(text),
    usesGrid: /\bdisplay\s*:\s*grid\b/i.test(text),
    usesPercent: /\b(?:width|height|left|right|top|bottom|gap|padding|margin)\s*:\s*[^;]*%/i.test(text),
    usesViewportUnits: /\b\d+(?:\.\d+)?v(?:w|h|min|max)\b/i.test(text),
    usesFr: /\b\d*(?:\.\d+)?fr\b/i.test(text),
    usesClampCalc: /\b(?:calc|min|max|clamp)\s*\(/i.test(text),
    fixedWidths: fixedWidths.slice(0, 20),
  };
}

function extractHtmlSummary(text) {
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const ids = unique([...text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])).slice(0, 80);
  const anchors = [...text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]).slice(0, 40);
  const images = [...text.matchAll(/<(?:img|source)\b[^>]*(?:src|srcset)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]).slice(0, 40);
  const forms = [...text.matchAll(/<form\b[^>]*>/gi)].length;
  const styleBlocks = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const inlineStyleCount = [...text.matchAll(/\bstyle\s*=\s*["'][^"']+["']/gi)].length;
  const scripts = [...text.matchAll(/<script\b[^>]*>/gi)].length;
  const externalStyles = [...text.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi)].length;
  return {
    title,
    ids,
    anchors,
    images,
    forms,
    inlineStyleCount,
    scripts,
    externalStyles,
    css: extractCssSignals(`${styleBlocks}\n${text}`),
  };
}

function sourceSignals(filePath, text) {
  const ext = path.extname(filePath).toLowerCase();
  const components = [];
  const routes = [];
  const styles = [];
  for (const m of text.matchAll(/\b(?:function|class|const)\s+([A-Z][A-Za-z0-9_]*)/g)) components.push(m[1]);
  for (const m of text.matchAll(/(?:path|route|href|to)\s*[:=]\s*["']([^"']+)["']/g)) routes.push(m[1]);
  for (const m of text.matchAll(/className\s*=\s*["']([^"']+)["']|class\s*=\s*["']([^"']+)["']/g)) {
    styles.push(...String(m[1] || m[2] || '').split(/\s+/));
  }
  if (ext === '.vue' || ext === '.svelte') {
    for (const m of text.matchAll(/<script[^>]*>|<template[^>]*>|<style[^>]*>/gi)) styles.push(m[0].replace(/[<>]/g, ''));
  }
  return {
    components: unique(components).slice(0, 40),
    routes: unique(routes).slice(0, 40),
    classes: unique(styles).slice(0, 80),
    css: extractCssSignals(text),
  };
}

async function listDirectory(dir) {
  const ignored = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '.nuxt', '.gradle', '.idea']);
  const out = [];
  async function walk(current) {
    if (out.length >= MAX_DIR_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_DIR_FILES) break;
      if (ignored.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTS.has(ext) || IMAGE_EXTS.has(ext) || ext === '.pdf') out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

function imageSizeFromBuffer(buf, ext) {
  if (ext === '.png' && buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  if ((ext === '.jpg' || ext === '.jpeg') && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  if (ext === '.gif' && buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' };
  }
  if (ext === '.webp' && buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    if (buf.toString('ascii', 12, 16) === 'VP8X') {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
        format: 'webp',
      };
    }
  }
  return null;
}

function parseFigmaUrl(value) {
  try {
    const url = new URL(value);
    if (!/figma\.com$/i.test(url.hostname) && !/\.figma\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const fileIndex = parts.findIndex((p) => p === 'file' || p === 'design');
    if (fileIndex < 0 || !parts[fileIndex + 1]) return null;
    return {
      url: value,
      fileKey: parts[fileIndex + 1],
      nodeId: url.searchParams.get('node-id') || url.searchParams.get('node_id') || null,
    };
  } catch {
    return null;
  }
}

function summarizeFigmaDocument(doc) {
  const nodes = [];
  const counts = {};
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || nodes.length >= MAX_FIGMA_NODES) return;
    const type = node.type || 'UNKNOWN';
    counts[type] = (counts[type] || 0) + 1;
    const box = node.absoluteBoundingBox || node.size || {};
    nodes.push({
      id: node.id,
      name: node.name,
      type,
      depth,
      width: typeof box.width === 'number' ? box.width : undefined,
      height: typeof box.height === 'number' ? box.height : undefined,
      layoutMode: node.layoutMode,
      constraints: node.constraints,
    });
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1);
  }
  visit(doc.document || doc);
  return { nodeCountSampled: nodes.length, typeCounts: counts, nodes };
}

async function maybeFetchFigma(figma, gaps) {
  const token = process.env.NATIVEUI_FIGMA_TOKEN || process.env.FIGMA_TOKEN;
  if (!token) {
    gaps.push({
      code: 'figma.token.missing',
      message: 'Figma URL detected but FIGMA_TOKEN/NATIVEUI_FIGMA_TOKEN is not set; ask the user for exported JSON or a token.',
      source: figma.url,
    });
    return null;
  }
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(figma.fileKey)}`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    gaps.push({
      code: 'figma.fetch.failed',
      message: `Figma API returned HTTP ${res.status}; use an exported JSON file or verify token access.`,
      source: figma.url,
    });
    return null;
  }
  return summarizeFigmaDocument(await res.json());
}

function pdftotextAvailable() {
  const r = spawnSync('pdftotext', ['-v'], { encoding: 'utf8', timeout: 3000 });
  return r.status === 0 || /pdftotext/i.test(r.stderr || r.stdout || '');
}

function extractPdfText(file) {
  if (!pdftotextAvailable()) return null;
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) return null;
  return truncate(r.stdout || '', 12000);
}

async function analyzeFile(file, bundle) {
  let st;
  try {
    st = await fs.stat(file);
  } catch (e) {
    throw new IntakeError(e.code === 'ENOENT' ? `Input not found: ${file}` : `Cannot stat ${file}: ${e.message}`);
  }
  if (st.isDirectory()) return analyzeDirectory(file, bundle);
  if (!st.isFile()) {
    bundle.gaps.push({ code: 'input.unsupported', message: 'Input is not a regular file or directory.', source: file });
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const source = { type: 'file', path: path.resolve(file), ext, bytes: st.size, confidence: confidence(0.7, ['file was readable']) };

  if (ext === '.html' || ext === '.htm') {
    const text = await fs.readFile(file, 'utf8');
    const html = extractHtmlSummary(text);
    Object.assign(source, { kind: 'html', html, excerpt: truncate(text, 6000), confidence: confidence(0.9, ['HTML/CSS text is directly inspectable']) });
    bundle.responsive.breakpoints.push(...html.css.breakpoints);
    bundle.responsive.mediaQueries.push(...html.css.mediaQueries);
    bundle.assets.push(...html.images.map((src) => ({ type: 'image-reference', src, source: file, embedded: /^data:/i.test(src) })));
    if (html.scripts) bundle.gaps.push({ code: 'html.script.present', message: 'Scripts are not valid NativeUI import input; convert behavior to interactions/backend code.', source: file });
    if (html.externalStyles) bundle.gaps.push({ code: 'html.external.stylesheet', message: 'External stylesheets are not valid NativeUI import input; inline CSS into <style>.', source: file });
  } else if (ext === '.css' || ext === '.scss' || ext === '.sass') {
    const text = await fs.readFile(file, 'utf8');
    const css = extractCssSignals(text);
    Object.assign(source, { kind: 'css', css, excerpt: truncate(text, 8000), confidence: confidence(0.85, ['CSS text is directly inspectable']) });
    bundle.responsive.breakpoints.push(...css.breakpoints);
    bundle.responsive.mediaQueries.push(...css.mediaQueries);
  } else if (ext === '.json') {
    const text = await fs.readFile(file, 'utf8');
    try {
      const json = JSON.parse(text);
      if (json.document || json.type === 'DOCUMENT') {
        Object.assign(source, { kind: 'figma-json', figma: summarizeFigmaDocument(json), confidence: confidence(0.88, ['Figma JSON structure was readable']) });
      } else if (Array.isArray(json.stages) || json.version) {
        Object.assign(source, { kind: 'project-json', project: { stages: Array.isArray(json.stages) ? json.stages.length : 0, libraryItems: Array.isArray(json.libraryItems) ? json.libraryItems.length : 0 }, confidence: confidence(0.8, ['Project JSON shape was detected']) });
      } else {
        Object.assign(source, { kind: 'json', keys: Object.keys(json).slice(0, 40), confidence: confidence(0.65, ['JSON was readable but not recognized as NativeUI/Figma']) });
      }
    } catch {
      bundle.gaps.push({ code: 'json.parse.failed', message: 'JSON file could not be parsed.', source: file });
      Object.assign(source, { kind: 'json-invalid', confidence: confidence(0.2, ['file exists but JSON parse failed']) });
    }
  } else if (ext === '.pdf') {
    const text = extractPdfText(file);
    Object.assign(source, {
      kind: 'pdf',
      textExcerpt: text,
      confidence: confidence(text ? 0.55 : 0.25, text ? ['pdftotext extracted text only; layout still needs visual inspection'] : ['no local PDF text extractor available']),
    });
    if (!text) bundle.gaps.push({ code: 'pdf.extractor.missing', message: 'Install pdftotext or provide screenshots/exported text for richer PDF intake.', source: file });
    bundle.gaps.push({ code: 'pdf.visual.layout', message: 'PDF visual layout requires screenshot/visual inspection before faithful screen recreation.', source: file });
  } else if (IMAGE_EXTS.has(ext)) {
    const buf = await fs.readFile(file);
    const size = imageSizeFromBuffer(buf, ext);
    Object.assign(source, { kind: 'image', image: size, confidence: confidence(size ? 0.45 : 0.3, ['image dimensions are known; semantics require visual inspection']) });
    bundle.assets.push({ type: 'image-file', path: path.resolve(file), width: size?.width, height: size?.height, source: file });
    if (ext === '.svg') {
      const text = buf.toString('utf8');
      Object.assign(source, { svgExcerpt: truncate(text, 8000), css: extractCssSignals(text) });
    }
    bundle.gaps.push({ code: 'image.visual.semantic', message: 'Image semantics, hierarchy, and text need visual/OCR inspection by the agent or user.', source: file });
  } else if (SOURCE_EXTS.has(ext)) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    Object.assign(source, { kind: 'source', source: sourceSignals(file, text), excerpt: truncate(text, 5000), confidence: confidence(0.7, ['source text is directly inspectable']) });
    bundle.responsive.breakpoints.push(...source.source.css.breakpoints);
    bundle.responsive.mediaQueries.push(...source.source.css.mediaQueries);
  } else {
    Object.assign(source, { kind: 'unknown', confidence: confidence(0.15, ['file type is not recognized by intake']) });
    bundle.gaps.push({ code: 'file.type.unknown', message: 'Unsupported file type; provide HTML/CSS, exported Figma JSON, PDF text, image, or source files.', source: file });
  }

  bundle.sources.push(source);
}

async function analyzeDirectory(dir, bundle) {
  const files = await listDirectory(dir);
  const extCounts = {};
  const codeFiles = [];
  const cssFiles = [];
  const htmlFiles = [];
  const imageFiles = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    extCounts[ext || '(none)'] = (extCounts[ext || '(none)'] || 0) + 1;
    if (ext === '.html' || ext === '.htm') htmlFiles.push(path.relative(dir, f));
    else if (ext === '.css' || ext === '.scss' || ext === '.sass') cssFiles.push(path.relative(dir, f));
    else if (IMAGE_EXTS.has(ext)) imageFiles.push(path.relative(dir, f));
    else if (SOURCE_EXTS.has(ext)) codeFiles.push(path.relative(dir, f));
  }
  const source = {
    type: 'directory',
    path: path.resolve(dir),
    scannedFiles: files.length,
    truncated: files.length >= MAX_DIR_FILES,
    extCounts,
    htmlFiles: htmlFiles.slice(0, 50),
    cssFiles: cssFiles.slice(0, 50),
    codeFiles: codeFiles.slice(0, 80),
    imageFiles: imageFiles.slice(0, 60),
    sourceSummary: { possibleRoutes: [], possibleComponents: [], classes: [] },
    confidence: confidence(0.72, ['directory was scanned; large projects are summarized']),
  };
  for (const rel of [...htmlFiles.slice(0, 12), ...cssFiles.slice(0, 12), ...codeFiles.slice(0, 30)]) {
    const full = path.join(dir, rel);
    const text = await fs.readFile(full, 'utf8').catch(() => '');
    const sig = sourceSignals(full, text);
    source.sourceSummary.possibleRoutes.push(...sig.routes);
    source.sourceSummary.possibleComponents.push(...sig.components);
    source.sourceSummary.classes.push(...sig.classes);
    bundle.responsive.breakpoints.push(...sig.css.breakpoints);
    bundle.responsive.mediaQueries.push(...sig.css.mediaQueries);
  }
  source.sourceSummary.possibleRoutes = unique(source.sourceSummary.possibleRoutes).slice(0, 80);
  source.sourceSummary.possibleComponents = unique(source.sourceSummary.possibleComponents).slice(0, 80);
  source.sourceSummary.classes = unique(source.sourceSummary.classes).slice(0, 120);
  if (source.truncated) bundle.gaps.push({ code: 'directory.scan.truncated', message: `Directory scan stopped at ${MAX_DIR_FILES} relevant files.`, source: dir });
  bundle.sources.push(source);
}

async function analyzeUrl(value, bundle) {
  const figma = parseFigmaUrl(value);
  if (figma) {
    const source = { type: 'url', kind: 'figma-url', ...figma, confidence: confidence(0.5, ['Figma URL parsed']) };
    const fetched = await maybeFetchFigma(figma, bundle.gaps);
    if (fetched) {
      source.figma = fetched;
      source.confidence = confidence(0.82, ['Figma API response was read with a user-provided token']);
    }
    bundle.sources.push(source);
    return;
  }
  bundle.sources.push({
    type: 'url',
    kind: 'remote-url',
    url: value,
    confidence: confidence(0.25, ['URL recorded but not fetched by default']),
  });
  bundle.gaps.push({
    code: 'url.fetch.not.performed',
    message: 'Remote URL was recorded only. Provide downloaded source/HTML/assets for deterministic intake.',
    source: value,
  });
}

function finalize(bundle) {
  bundle.responsive.breakpoints = unique(bundle.responsive.breakpoints).sort((a, b) => a - b);
  bundle.responsive.mediaQueries = unique(bundle.responsive.mediaQueries);
  const kinds = {};
  for (const s of bundle.sources) kinds[s.kind || s.type] = (kinds[s.kind || s.type] || 0) + 1;
  const directInputs = bundle.sources.filter((s) => ['html', 'css', 'source', 'figma-json', 'project-json'].includes(s.kind));
  const visualOnly = bundle.sources.filter((s) => ['pdf', 'image', 'figma-url'].includes(s.kind));
  bundle.summary = {
    inputCount: bundle.inputs.length + (bundle.prompt ? 1 : 0),
    sourceKinds: kinds,
    assets: bundle.assets.length,
    breakpoints: bundle.responsive.breakpoints,
    hasDirectAuthoringSource: directInputs.length > 0,
    hasVisualOnlySource: visualOnly.length > 0,
    gapCount: bundle.gaps.length,
  };
  bundle.nextSteps = [
    'Use this bundle to plan screens, tokens, components, assets, repeaters, and responsive breakpoints before authoring NativeUI HTML/CSS.',
    'Run nui-responsive-audit.mjs on authored HTML before import/export.',
  ];
  if (bundle.gaps.length) bundle.nextSteps.unshift('Resolve or explicitly acknowledge intake gaps before claiming visual fidelity.');
  bundle.overallConfidence = confidence(
    Math.max(0.1, Math.min(0.95, 0.85 - bundle.gaps.length * 0.06 + directInputs.length * 0.03 - visualOnly.length * 0.02)),
    bundle.gaps.length ? ['confidence reduced by unresolved intake gaps'] : ['inputs were directly inspectable']
  );
  return bundle;
}

async function main() {
  try {
    const { inputs, out, prompt } = parseArgs(process.argv.slice(2));
    const bundle = {
      version: 1,
      createdAt: new Date().toISOString(),
      tool: 'nui-intake',
      responsiveTargets: DEFAULT_TARGETS,
      prompt: prompt.trim() || undefined,
      inputs,
      sources: [],
      assets: [],
      responsive: { breakpoints: [], mediaQueries: [] },
      gaps: [],
    };
    if (prompt.trim()) {
      bundle.sources.push({
        type: 'prompt',
        kind: 'prompt',
        excerpt: truncate(prompt.trim(), 4000),
        confidence: confidence(0.35, ['natural language is intent, not measured layout']),
      });
    }
    for (const input of inputs) {
      if (isUrl(input)) await analyzeUrl(input, bundle);
      else await analyzeFile(input, bundle);
    }
    finalize(bundle);
    const outPath = path.resolve(out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(bundle, null, 2));
    process.stdout.write(`Wrote intake bundle -> ${outPath}\n`);
    process.stdout.write(`  sources: ${bundle.sources.length}, assets: ${bundle.assets.length}, gaps: ${bundle.gaps.length}\n`);
  } catch (err) {
    if (err instanceof IntakeError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
