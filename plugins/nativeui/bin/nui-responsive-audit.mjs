#!/usr/bin/env node
// nui-responsive-audit.mjs - fail-closed responsive audit for NativeUI inputs.
//
// Accepts HTML/CSS files or project.json and reports breakpoints/divisions,
// semantic responsive fields, fixed-width smells, overflow risks, and authored
// breakpoint coverage. It exits non-zero when no responsive path is detected.
// The deprecated --allow-static audit flag remains parse-compatible but can
// no longer bypass this gate. It is unrelated to a web lane's static
// build/hosting render mode.
//
// Usage:
//   node bin/nui-responsive-audit.mjs <file.html|project.json...> [-o report.json] [--allow-static]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class ResponsiveAuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResponsiveAuditError';
  }
}

const USAGE = 'Usage: node bin/nui-responsive-audit.mjs <html|css|project.json...> [-o report.json] [--allow-static]';

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

const INLINE_ROOT_SIZE_PROPERTIES = new Set([
  'width', 'min-width', 'max-width',
  'inline-size', 'min-inline-size', 'max-inline-size',
]);
const BLOCK_ROOT_SIZE_PROPERTIES = new Set([
  'height', 'min-height', 'max-height',
  'block-size', 'min-block-size', 'max-block-size',
]);
const CSS_NESTING_AT_RULES = /^(?:@media|@supports|@container|@layer|@scope|@document)\b/i;
const CSS_KEYFRAMES_AT_RULE = /^@(?:-webkit-)?keyframes\b/i;
const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function cssQuotedEnd(source, opening, end = source.length) {
  const quote = source[opening];
  for (let cursor = opening + 1; cursor < end; cursor++) {
    if (source[cursor] === '\\') cursor++;
    else if (source[cursor] === quote) return cursor + 1;
  }
  return end;
}

function cssCommentEnd(source, opening, end = source.length) {
  const close = source.indexOf('*/', opening + 2);
  return close < 0 || close + 2 > end ? end : close + 2;
}

function matchingCssBrace(source, opening, end = source.length) {
  let depth = 1;
  for (let cursor = opening + 1; cursor < end; cursor++) {
    const current = source[cursor];
    if (current === '/' && source[cursor + 1] === '*') {
      cursor = cssCommentEnd(source, cursor, end) - 1;
    } else if (current === '"' || current === "'" || current === '`') {
      cursor = cssQuotedEnd(source, cursor, end) - 1;
    } else if (current === '{') {
      depth++;
    } else if (current === '}' && --depth === 0) {
      return cursor;
    }
  }
  return -1;
}

function directCssDeclarations(source, start, end) {
  const direct = [...source.slice(start, end)];
  let cursor = start;
  while (cursor < end) {
    const current = source[cursor];
    if (current === '/' && source[cursor + 1] === '*') {
      const close = cssCommentEnd(source, cursor, end);
      direct.fill(' ', cursor - start, close - start);
      cursor = close;
    } else if (current === '"' || current === "'" || current === '`') {
      cursor = cssQuotedEnd(source, cursor, end);
    } else if (current === '{') {
      const close = matchingCssBrace(source, cursor, end);
      const blockEnd = close < 0 ? end : close + 1;
      direct.fill(' ', cursor - start, blockEnd - start);
      cursor = blockEnd;
    } else {
      cursor++;
    }
  }
  return direct.join('');
}

function splitCssSelectors(prelude) {
  const selectors = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < prelude.length; index++) {
    const current = prelude[index];
    if (current === '"' || current === "'") {
      index = cssQuotedEnd(prelude, index) - 1;
    } else if (current === '(') parentheses++;
    else if (current === ')' && parentheses > 0) parentheses--;
    else if (current === '[') brackets++;
    else if (current === ']' && brackets > 0) brackets--;
    else if (current === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors;
}

function terminalCompoundSelector(selector) {
  const normalized = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  let parentheses = 0;
  let brackets = 0;
  let lastBoundary = 0;
  for (let index = 0; index < normalized.length; index++) {
    const current = normalized[index];
    if (current === '"' || current === "'") {
      index = cssQuotedEnd(normalized, index) - 1;
    } else if (current === '(') parentheses++;
    else if (current === ')' && parentheses > 0) parentheses--;
    else if (current === '[') brackets++;
    else if (current === ']' && brackets > 0) brackets--;
    else if (parentheses === 0 && brackets === 0
      && (current === '>' || current === '+' || current === '~' || /\s/.test(current))) {
      lastBoundary = index + 1;
    }
  }
  return normalized.slice(lastBoundary).trim();
}

function attributeValue(attributes, name) {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attributes);
  if (quoted) return quoted[2];
  return new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(attributes)?.[1] || '';
}

function attributeClasses(attributes) {
  return attributeValue(attributes, 'class(?:Name)?').trim().split(/\s+/).filter(Boolean);
}

function isLiteralRouteWrapper(tag, attributes) {
  const id = attributeValue(attributes, 'id');
  const classes = attributeClasses(attributes);
  return /^route-[a-z0-9_-]+$/i.test(id)
    || classes.some((value) => /^(?:page|page-canvas)$/i.test(value));
}

/** Exact ids of compiler route roots nested directly under a .page/#route-* delivery wrapper. */
function discoverRouteRootSelectors(text) {
  const selectors = new Set();
  const stack = [];
  const tagPattern = /<\s*(\/)?\s*([a-z][a-z0-9:_-]*)\b([^>]*)>/gi;
  let match;
  while ((match = tagPattern.exec(text))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const attributes = match[3] || '';
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const parent = stack.at(-1);
    if (parent?.routeWrapper) {
      const id = attributeValue(attributes, 'id');
      const classes = attributeClasses(attributes);
      if (id && id !== 'page-title' && id !== 'action-error'
        && !classes.some((value) => value.toLowerCase() === 'visually-hidden')) {
        selectors.add(`#${id.toLowerCase()}`);
      }
    }
    if (!HTML_VOID_TAGS.has(tag) && !/\/\s*$/.test(attributes)) {
      stack.push({ tag, routeWrapper: isLiteralRouteWrapper(tag, attributes) });
    }
  }
  return selectors;
}

function selectorIsLayoutRoot(selector, discoveredRoots = new Set(), inheritedRoot = false) {
  const terminal = terminalCompoundSelector(selector).toLowerCase();
  if (inheritedRoot && /^&(?=$|[.#:\[])/.test(terminal)) return true;
  if (/^(?::root|html|body|main)(?=$|[^a-z0-9_-])/.test(terminal)) return true;
  if (/(?:^|[^a-z0-9_-])#(?:app|root|route-[a-z0-9_-]+)(?=$|[^a-z0-9_-])/.test(terminal)) return true;
  if (/(?:^|[^a-z0-9_-])\.(?:app|screen|page|page-canvas)(?=$|[^a-z0-9_-])/.test(terminal)) return true;
  for (const root of discoveredRoots) {
    if (terminal.includes(root) && new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_-])`).test(terminal)) {
      return true;
    }
  }
  return false;
}

function cssSources(text) {
  const sources = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;
  while ((match = pattern.exec(text))) {
    sources.push({ css: match[1], offset: match.index + match[0].indexOf(match[1]) });
  }
  if (!sources.length && !/<[a-z!/][\s\S]*>/i.test(text)) sources.push({ css: text, offset: 0 });
  return sources;
}

function walkCssRules(source, offset, discoveredRoots, visit, start = 0, end = source.length, inheritedRoot = false) {
  let segmentStart = start;
  let cursor = start;
  while (cursor < end) {
    const current = source[cursor];
    if (current === '/' && source[cursor + 1] === '*') {
      cursor = cssCommentEnd(source, cursor, end);
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      cursor = cssQuotedEnd(source, cursor, end);
      continue;
    }
    if (current === ';') {
      segmentStart = cursor + 1;
      cursor++;
      continue;
    }
    if (current !== '{') {
      cursor++;
      continue;
    }
    const close = matchingCssBrace(source, cursor, end);
    if (close < 0) return;
    const prelude = source.slice(segmentStart, cursor).trim();
    // Comments may contain commas, apostrophes, and selector-looking prose.
    // Remove them before selector tokenization so they cannot hide a real root
    // rule (for example, `/* NativeUI's ... */ body { ... }`). Keep the
    // original prelude in findings for useful diagnostics.
    const selectorPrelude = prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const atRule = selectorPrelude.startsWith('@');
    const root = atRule
      ? inheritedRoot
      : splitCssSelectors(selectorPrelude).some((selector) => selectorIsLayoutRoot(selector, discoveredRoots, inheritedRoot));
    if (root) {
      visit({
        selector: prelude,
        declarations: directCssDeclarations(source, cursor + 1, close),
        declarationOffset: offset + cursor + 1,
      });
    }
    if (!CSS_KEYFRAMES_AT_RULE.test(selectorPrelude)
      && (!atRule || CSS_NESTING_AT_RULES.test(selectorPrelude))) {
      walkCssRules(source, offset, discoveredRoots, visit, cursor + 1, close, root);
    }
    cursor = close + 1;
    segmentStart = cursor;
  }
}

function fixedRootSizeDeclarations(text) {
  const discoveredRoots = discoverRouteRootSelectors(text);
  const findings = [];
  const inspect = ({ selector, declarations, declarationOffset }) => {
    const declaration = /(?:^|;)\s*(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|min-inline-size|min-block-size|max-inline-size|max-block-size)\s*:\s*(-?\d+(?:\.\d+)?)px\b[^;}]*/gim;
    let match;
    while ((match = declaration.exec(declarations))) {
      const property = match[1].toLowerCase();
      const value = Number(match[2]);
      if (value === 0 && (property.startsWith('min-'))) continue;
      findings.push({
        axis: INLINE_ROOT_SIZE_PROPERTIES.has(property) ? 'inline' : 'block',
        property,
        value,
        selector,
        index: declarationOffset + match.index,
        snippet: match[0].trim().replace(/\s+/g, ' '),
      });
    }
  };
  for (const source of cssSources(text)) {
    walkCssRules(source.css, source.offset, discoveredRoots, inspect);
  }
  const tagPattern = /<\s*([a-z][a-z0-9:_-]*)\b([^>]*)>/gi;
  let tag;
  while ((tag = tagPattern.exec(text))) {
    const name = tag[1].toLowerCase();
    const attributes = tag[2] || '';
    const id = attributeValue(attributes, 'id').toLowerCase();
    const classes = attributeClasses(attributes).map((value) => value.toLowerCase());
    const root = /^(?:html|body|main)$/.test(name)
      || /^(?:app|root|route-[a-z0-9_-]+)$/.test(id)
      || classes.some((value) => /^(?:app|screen|page|page-canvas)$/.test(value))
      || discoveredRoots.has(`#${id}`);
    if (!root) continue;
    const style = attributeValue(attributes, 'style');
    if (!style) continue;
    inspect({
      selector: `<${name}${id ? `#${id}` : ''}>`,
      declarations: style,
      declarationOffset: tag.index + tag[0].indexOf(style),
    });
  }
  return findings;
}

function cssSignals(text) {
  const media = extractMediaQueries(text);
  const fixedWidthSmells = fixedRootSizeDeclarations(text)
    .filter((finding) => finding.axis === 'inline')
    .map((finding) => ({
      property: finding.property,
      value: finding.value,
      ...lineCol(text, finding.index),
      snippet: text.slice(Math.max(0, finding.index - 30), Math.min(text.length, finding.index + 80)).replace(/\s+/g, ' '),
    }));
  const overflowRisks = [];
  const riskPatterns = [
    { code: 'nowrap', re: /\bwhite-space\s*:\s*nowrap\b/gi },
    { code: 'absolute-fixed', re: /\bposition\s*:\s*absolute\b[\s\S]{0,180}\bwidth\s*:\s*\d+(?:\.\d+)?px\b/gi },
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

function breakpointCoverage(breakpoints) {
  return Object.fromEntries(
    unique(breakpoints)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((value) => [`${value}px`, true]),
  );
}

function parentConstraintSignals(text) {
  // Root checks use the same nested-rule walker as the authored-source gate.
  // A fluid document ancestor cannot excuse a fixed route/page wrapper or its
  // compiler-emitted direct stage root; descendant cards/media stay intrinsic.
  const fixedRootSizes = fixedRootSizeDeclarations(text);
  const fixedRootWidths = fixedRootSizes.filter((finding) => finding.axis === 'inline').map((finding) => finding.value);
  const fixedRootHeights = fixedRootSizes.filter((finding) => finding.axis === 'block').map((finding) => finding.value);
  let fluidRoot = false;
  const discoveredRoots = discoverRouteRootSelectors(text);
  const inspectFluid = ({ declarations }) => {
    if (/(?:^|;)\s*(?:width|inline-size)\s*:\s*(?:100%(?=\s*(?:;|$))|auto\b)/i.test(declarations)) {
      fluidRoot = true;
    }
  };
  for (const source of cssSources(text)) {
    walkCssRules(source.css, source.offset, discoveredRoots, inspectFluid);
  }
  const inlineRootStyle = /<(?:html|body|main)\b[^>]*\bstyle\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let rootMatch;
  while ((rootMatch = inlineRootStyle.exec(text))) inspectFluid({ declarations: rootMatch[1] || '' });
  if (!fluidRoot && !fixedRootWidths.length) {
    fluidRoot = /\b(?:main|\.app|\.screen|\.page(?:-canvas)?|#app|#root|#route-[a-z0-9_-]+)\b[^{}]*\{[^{}]*\b(?:width|inline-size)\s*:\s*100%/i.test(text);
  }
  const structuralLayout = /\bdisplay\s*:\s*(?:flex|grid)\b/i.test(text);
  const fillSizing = /\b(?:width\s*:\s*100%|flex(?:-grow)?\s*:\s*(?:[1-9]|\d+\.\d+)|flex\s*:\s*(?:[1-9]|\d+\.\d+)|minmax\s*\(\s*0\s*,\s*[^)]+fr\b)/i.test(text);
  const shrinkSafe = /\bmin-width\s*:\s*0(?:px)?\b/i.test(text);
  const maxWidthCap = /\bmax-width\s*:\s*(?:\d+(?:\.\d+)?(?:px|rem|em)|\d+(?:\.\d+)?%)\b/i.test(text);
  const pairedInlineAnchors = /\{[^{}]*\bleft\s*:[^;{}]+;[^{}]*\bright\s*:/i.test(text)
    || /\{[^{}]*\bright\s*:[^;{}]+;[^{}]*\bleft\s*:/i.test(text);
  const pairedBlockAnchors = /\{[^{}]*\btop\s*:[^;{}]+;[^{}]*\bbottom\s*:/i.test(text)
    || /\{[^{}]*\bbottom\s*:[^;{}]+;[^{}]*\btop\s*:/i.test(text);
  return {
    fluidRoot,
    fixedRootWidths,
    fixedRootHeights,
    structuralLayout,
    fillSizing,
    shrinkSafe,
    maxWidthCap,
    pairedInlineAnchors,
    pairedBlockAnchors,
  };
}

function coverageFromBreakpoints(breakpoints, hasResponsivePath) {
  return unique(breakpoints)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .map((width, index) => ({
      name: `authored-${index + 1}`,
      width,
      covered: hasResponsivePath,
    }));
}

export function analyzeHtmlResponsiveSource(text, input = '<html>') {
  const sig = cssSignals(text);
  const flexibleCount = Object.values(sig.flexibleSignals).filter(Boolean).length;
  const coverage = breakpointCoverage(sig.breakpoints);
  const constraints = parentConstraintSignals(text);
  const requiredBreakpoints = [];
  const hasResponsivePath = constraints.fluidRoot
    && constraints.fixedRootWidths.length === 0
    && constraints.fixedRootHeights.length === 0
    && constraints.structuralLayout
    && constraints.fillSizing
    && constraints.shrinkSafe;
  const warnings = [];
  if (flexibleCount < 2) warnings.push('Few flexible layout signals detected; prefer %, fr, flex-grow, grid, viewport units, or calc/clamp.');
  if (sig.fixedWidthSmells.length) warnings.push(`${sig.fixedWidthSmells.length} fixed width smell(s) may block reflow.`);
  if (sig.overflowRisks.length) warnings.push(`${sig.overflowRisks.length} overflow risk(s) detected.`);
  if (!constraints.fluidRoot) warnings.push('Page root is not fluid; use body/page-root width:100% and min-width:0.');
  if (constraints.fixedRootWidths.length) warnings.push(`Fixed root width(s) create a non-reflowing island: ${constraints.fixedRootWidths.join(', ')}px.`);
  if (constraints.fixedRootHeights.length) warnings.push(`Fixed root height(s) create a non-reflowing island: ${constraints.fixedRootHeights.join(', ')}px.`);
  if (!constraints.structuralLayout) warnings.push('No flex/grid parent layout detected.');
  if (!constraints.fillSizing) warnings.push('No parent-owned fill sizing detected.');
  if (!constraints.shrinkSafe) warnings.push('No min-width:0 shrink constraint detected for fluid flex/grid content.');
  return {
    input: input === '<html>' ? input : path.resolve(input),
    kind: 'html-css',
    ok: hasResponsivePath,
    hasResponsivePath,
    breakpoints: sig.breakpoints,
    breakpointCoverage: coverage,
    requiredBreakpoints,
    mediaQueries: sig.queries,
    flexibleSignals: sig.flexibleSignals,
    parentConstraints: constraints,
    fixedWidthSmells: sig.fixedWidthSmells,
    overflowRisks: sig.overflowRisks,
    targetCoverage: coverageFromBreakpoints(sig.breakpoints, hasResponsivePath),
    warnings,
  };
}

async function analyzeHtmlFile(file) {
  const text = await fs.readFile(file, 'utf8').catch((e) => {
    throw new ResponsiveAuditError(e.code === 'ENOENT' ? `Input not found: ${file}` : `Could not read ${file}: ${e.message}`);
  });
  return analyzeHtmlResponsiveSource(text, file);
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
  for (const k of Object.keys(node.parentLayoutProps || {})) {
    if (k.startsWith('nui.semantic') || k.startsWith('anchor.') || /^(?:hbox\.hgrow|vbox\.vgrow|grid\.)/.test(k)) count++;
  }
  return count;
}

function divisionWidthValues(division) {
  const values = [
    division?.minWidth,
    division?.minWidthPx,
    division?.boundaryPx,
    division?.width,
    division?.previewWidthPx,
  ].filter((value) => typeof value === 'number' && Number.isFinite(value));
  const query = String(division?.queryCondition || division?.condition || '');
  for (const match of query.matchAll(/\b(\d+(?:\.\d+)?)px\b/g)) values.push(Number(match[1]));
  return values;
}

function nodeHasFluidParentConstraint(node) {
  const props = node?.parentLayoutProps || {};
  const semantic = String(node?.layoutSpec?.widthIntent || node?.semanticWidth || props['nui.semanticWidth'] || '').toLowerCase();
  return semantic === 'fill' || semantic === '100%' || semantic.endsWith('%')
    || (props['anchor.left'] != null && props['anchor.right'] != null)
    || props['hbox.hgrow'] === 'ALWAYS' || props['vbox.vgrow'] === 'ALWAYS';
}

function nodeHasFluidBlockConstraint(node) {
  const props = node?.parentLayoutProps || {};
  const semantic = String(node?.layoutSpec?.heightIntent || node?.semanticHeight || props['nui.semanticHeight'] || '').toLowerCase();
  const minimum = String(node?.layoutSpec?.minHeightIntent || props['nui.semanticMinHeight'] || '').toLowerCase();
  return semantic === 'fill' || semantic === 'auto' || semantic === '100%' || semantic.endsWith('%')
    || /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:vh|dvh|svh|lvh)$/.test(semantic)
    || ['min-content', 'max-content', 'fit-content', 'stretch'].some((value) => semantic.startsWith(value))
    || /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:vh|dvh|svh|lvh)$/.test(minimum)
    || (props['anchor.top'] != null && props['anchor.bottom'] != null)
    || props['vbox.vgrow'] === 'ALWAYS';
}

function positiveFiniteField(node, field) {
  return typeof node?.[field] === 'number' && Number.isFinite(node[field]) && node[field] > 0;
}

function fixedPixelIntent(value) {
  return /^\s*\d+(?:\.\d+)?px\s*$/i.test(String(value || ''));
}

export function analyzeProjectResponsiveValue(project, input = '<project>') {
  if (!project || typeof project !== 'object' || !Array.isArray(project.stages)) {
    throw new ResponsiveAuditError(`JSON input is not a NativeUI project (missing stages[]): ${input}`);
  }
  const stages = [];
  let totalDivisions = 0;
  let semanticFieldCount = 0;
  let overrideNodes = 0;
  let parentConstraintNodes = 0;
  let fluidRootCount = 0;
  let fluidBlockRootCount = 0;
  let totalRootCount = 0;
  const fixedWidthSmells = [];
  const fixedHeightSmells = [];
  const allDivisionWidths = [];
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
        minWidth: d.minWidth ?? d.minWidthPx ?? d.boundaryPx,
        maxWidth: d.maxWidth,
        width: d.width ?? d.previewWidthPx,
        queryCondition: d.queryCondition,
      })),
      semanticNodes: 0,
      overrideNodes: 0,
    };
    for (const division of divisions) allDivisionWidths.push(...divisionWidthValues(division));
    for (const root of Array.isArray(st.rootNodes) ? st.rootNodes : []) {
      totalRootCount++;
      if (nodeHasFluidParentConstraint(root)) {
        fluidRootCount++;
      } else {
        for (const field of ['width', 'prefWidth', 'minWidth']) {
          if (positiveFiniteField(root, field)) {
            fixedWidthSmells.push({ stage: st.name || st.stageId || `stage-${index + 1}`, nodeId: root.id, field, value: root[field] });
          }
        }
        const widthIntent = root?.layoutSpec?.widthIntent || root?.semanticWidth || root?.parentLayoutProps?.['nui.semanticWidth'];
        if (fixedPixelIntent(widthIntent)) {
          fixedWidthSmells.push({ stage: st.name || st.stageId || `stage-${index + 1}`, nodeId: root.id, field: 'semanticWidth', value: widthIntent });
        }
      }

      const hasFixedBlockSnapshot = ['height', 'prefHeight', 'minHeight', 'maxHeight']
        .some((field) => positiveFiniteField(root, field));
      const heightIntent = root?.layoutSpec?.heightIntent || root?.semanticHeight || root?.parentLayoutProps?.['nui.semanticHeight'];
      const fixedBlockIntent = fixedPixelIntent(heightIntent);
      if (nodeHasFluidBlockConstraint(root) || (!hasFixedBlockSnapshot && !fixedBlockIntent)) {
        fluidBlockRootCount++;
      } else {
        for (const field of ['height', 'prefHeight', 'minHeight', 'maxHeight']) {
          if (positiveFiniteField(root, field)) {
            fixedHeightSmells.push({ stage: st.name || st.stageId || `stage-${index + 1}`, nodeId: root.id, field, value: root[field] });
          }
        }
        if (fixedBlockIntent) {
          fixedHeightSmells.push({ stage: st.name || st.stageId || `stage-${index + 1}`, nodeId: root.id, field: 'semanticHeight', value: heightIntent });
        }
      }
    }
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
      if (nodeHasFluidParentConstraint(node)) parentConstraintNodes++;
    });
    stages.push(stage);
  }
  const coverage = breakpointCoverage(allDivisionWidths);
  const requiredBreakpoints = [];
  const hasResponsiveMetadata =
    totalDivisions > 0 ||
    semanticFieldCount > 0 ||
    overrideNodes > 0 ||
    stages.some((s) => Number(s.responsiveLayoutVersion) >= 1);
  const hasResponsivePath = hasResponsiveMetadata
    && totalRootCount >= stages.length
    && fluidRootCount >= totalRootCount
    && fluidBlockRootCount >= totalRootCount
    && parentConstraintNodes > 0;
  const warnings = [];
  if (!semanticFieldCount) warnings.push('No semantic responsive node fields detected.');
  if (fluidRootCount < totalRootCount) warnings.push('Every stage root needs fluid inline sizing constrained by its parent.');
  if (fluidBlockRootCount < totalRootCount) warnings.push('Every stage root needs intrinsic or parent-constrained block sizing.');
  if (!parentConstraintNodes) warnings.push('No parent-relative semantic, anchor, grow, or grid constraints detected.');
  if (fixedWidthSmells.length) warnings.push(`${fixedWidthSmells.length} fixed root width(s) detected.`);
  if (fixedHeightSmells.length) warnings.push(`${fixedHeightSmells.length} fixed root height(s) detected.`);
  return {
    input: input === '<project>' ? input : path.resolve(input),
    kind: 'project-json',
    ok: hasResponsivePath,
    hasResponsivePath,
    stages,
    divisionCount: totalDivisions,
    breakpoints: unique(allDivisionWidths).sort((a, b) => a - b),
    breakpointCoverage: coverage,
    requiredBreakpoints,
    semanticFieldCount,
    overrideNodes,
    parentConstraintNodes,
    fluidRootCount,
    fluidBlockRootCount,
    fixedWidthSmells: fixedWidthSmells.slice(0, 80),
    fixedHeightSmells: fixedHeightSmells.slice(0, 80),
    targetCoverage: coverageFromBreakpoints(
      allDivisionWidths,
      hasResponsivePath
    ),
    warnings,
  };
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
  return analyzeProjectResponsiveValue(project, file);
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
      allowStaticRequested: allowStatic,
      allowStaticIgnored: allowStatic,
      ok: failing.length === 0,
      targets: unique(items.flatMap((item) => item.breakpoints || []))
        .sort((a, b) => a - b)
        .map((width, index) => ({ name: `authored-${index + 1}`, width })),
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
      process.stderr.write('Responsive audit failed: every NativeUI design requires a responsive path; the deprecated --allow-static audit flag cannot bypass this contract and is unrelated to static web build/hosting mode.\n');
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
