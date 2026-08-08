#!/usr/bin/env node
// nui-final-review.mjs - final NativeUI design review gate for agents.
//
// Reviews authored HTML, project.json, optional intake bundles, and optional
// exported native dirs. It catches invalid import surface, missing responsive
// paths, unresolved event/backend work, and app logic placed in NuiBackend
// instead of durable connector classes.
//
// Usage:
//   node bin/nui-final-review.mjs --project project.json [--html a.html ...]
//     [--intake nativeui-intake.json] [--android-dir ./android-out] [--ios-dir ./ios-out]
//     [--architecture nativeui-architecture.md] [--instructions "..."] [--allow-static]
//     [--json|--human] [-o report.json]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTargets } from './target-contract.mjs';
import { auditFlowInputs } from './nui-flow-audit.mjs';
import { analyzeHtmlResponsiveSource, analyzeProjectResponsiveValue } from './nui-responsive-audit.mjs';
import {
  readExportManifest,
  resolveManifestTargetRoots,
} from './export-manifest.mjs';
import { validateArchitectureDecisions } from './delivery-decision-validation.mjs';

class ReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewError';
  }
}

const USAGE = 'Usage: node bin/nui-final-review.mjs --project project.json [--html file...] [--target auto|<target-id|group>...] [--all-targets] [--target-dir <target-id>=<dir>...] [--android-dir dir] [--ios-dir dir] [--allow-static] [--json|--human]';
const BACKEND_REQUIRED_ACTIONS = new Set(['CALL_API', 'CALL_DATABASE', 'SUBMIT_FORM', 'PLAY_TIMELINE']);
const GATED_ACTIONS = new Set(['RUN_SCRIPT']);
const ARCHITECTURE_REQUIRED_HEADINGS = [
  'Audit Summary',
  'Selected Delivery Targets',
  'Recommended Stack',
  'Alternatives',
  'Local Run Plan',
  'Client Delivery And Hosting',
  'Deployment Plan',
  'Repository Layout',
  'API Database Auth Contract',
  'Secret Policy',
  'NativeUI Wiring Plan',
  'Implementation Phases',
  'Approval',
];

function parseArgs(argv) {
  const html = [];
  let project = '';
  let intake = '';
  let androidDir = '';
  let iosDir = '';
  let architecture = '';
  let instructions = '';
  let allowStatic = false;
  let format = 'json';
  let out = '';
  const targetTokens = [];
  let allTargets = false;
  const targetDirs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') {
      project = argv[++i] || '';
    } else if (a === '--html') {
      while (argv[i + 1] && !argv[i + 1].startsWith('-')) html.push(argv[++i]);
    } else if (a === '--intake') {
      intake = argv[++i] || '';
    } else if (a === '--android-dir') {
      androidDir = argv[++i] || '';
    } else if (a === '--ios-dir') {
      iosDir = argv[++i] || '';
    } else if (a === '--target') {
      targetTokens.push(String(argv[++i] || '').toLowerCase());
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === '--target-dir') {
      const value = argv[++i] || '';
      const split = value.indexOf('=');
      if (split <= 0) throw new ReviewError('--target-dir must be <target-id>=<dir>.');
      targetDirs[value.slice(0, split)] = value.slice(split + 1);
    } else if (a === '--architecture') {
      architecture = argv[++i] || '';
    } else if (a === '--instructions') {
      instructions = argv[++i] || '';
    } else if (a === '--allow-static') {
      allowStatic = true;
    } else if (a === '--json') {
      format = 'json';
    } else if (a === '--human') {
      format = 'human';
    } else if (a === '-o' || a === '--output') {
      out = argv[++i] || '';
    } else if (a === '-h' || a === '--help') {
      throw new ReviewError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ReviewError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project && path.extname(a).toLowerCase() === '.json') {
      project = a;
    } else {
      html.push(a);
    }
  }
  if (!project && !html.length) throw new ReviewError(`Provide --project and/or --html input.\n${USAGE}`);
  const explicitTargets = targetTokens.length || allTargets;
  const selectedTargets = explicitTargets
    ? resolveTargets(targetTokens, { allTargets, defaults: true })
    : [];
  return { project, html, intake, androidDir, iosDir, architecture, instructions, allowStatic, format, out, explicitTargets, selectedTargets, targetDirs };
}

function add(findings, severity, code, message, source, detail) {
  findings.push({ severity, code, message, source, ...(detail ? { detail } : {}) });
}

function unique(values) {
  return [...new Set(values.filter((v) => v !== undefined && v !== null && String(v).trim() !== ''))];
}

function cssSignals(text) {
  const mediaQueries = [];
  const breakpoints = [];
  const mediaRe = /@media\s*([^{]+)\{/gi;
  let m;
  while ((m = mediaRe.exec(text))) {
    const condition = m[1].trim().replace(/\s+/g, ' ');
    mediaQueries.push(condition);
    for (const n of condition.match(/\b\d+(?:\.\d+)?px\b/g) || []) breakpoints.push(Number(n.replace('px', '')));
  }
  const flexibleSignals = [
    /\bdisplay\s*:\s*flex\b/i,
    /\bdisplay\s*:\s*grid\b/i,
    /\b(?:width|height|left|right|top|bottom|gap|padding|margin)\s*:\s*[^;]*%/i,
    /\b\d*(?:\.\d+)?fr\b/i,
    /\b\d+(?:\.\d+)?v(?:w|h|min|max)\b/i,
    /\b(?:calc|min|max|clamp)\s*\(/i,
    /\bflex(?:-grow)?\s*:\s*(?:[1-9]|\d+\.\d+)/i,
  ].filter((re) => re.test(text)).length;
  return { mediaQueries: unique(mediaQueries), breakpoints: unique(breakpoints).sort((a, b) => a - b), flexibleSignals };
}

async function reviewHtml(files, findings, allowStatic) {
  const summaries = [];
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      throw new ReviewError(e.code === 'ENOENT' ? `HTML input not found: ${file}` : `Could not read ${file}: ${e.message}`);
    }
    const sig = cssSignals(text);
    const responsive = analyzeHtmlResponsiveSource(text, file);
    const hasResponsivePath = responsive.ok;
    const source = path.resolve(file);
    if (/<script\b/i.test(text)) add(findings, 'error', 'html.script', 'NativeUI import forbids <script>; move behavior into interactions/connectors.', source);
    if (/<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(text)) add(findings, 'error', 'html.external-stylesheet', 'External stylesheets are not valid import input; inline CSS into <style>.', source);
    const unsupportedDataAttrs = [...text.matchAll(/\s(data-[a-z0-9_:-]+)\s*=/gi)]
      .map((match) => match[1].toLowerCase())
      .filter((name) => !new Set(['data-nui-list', 'data-nui-item', 'data-nui-bind', 'data-nui-list-state', 'data-nui-on-tap', 'data-nui-select-group']).has(name));
    if (unsupportedDataAttrs.length) add(findings, 'warn', 'html.data-attrs', 'Unsupported data-* attributes are stripped/ignored by import; use only the sanctioned list/action vocabulary.', source, { attributes: unique(unsupportedDataAttrs) });
    if (/<img\b[^>]*src\s*=\s*["']https?:\/\//i.test(text) || /url\(\s*["']?https?:\/\//i.test(text)) {
      add(findings, 'error', 'asset.remote-image', 'Remote images render blank off-browser; inline as data: base64 or import as assets.', source);
    }
    if (/\b(?:conic-gradient|repeating-(?:linear|radial)-gradient)\s*\(/i.test(text)) {
      add(findings, 'warn', 'css.gradient-unsupported', 'Conic/repeating gradients degrade; use supported linear-gradient/radial-gradient or SVG primitives.', source);
    }
    if (/\btext-align\s*:\s*justify\b/i.test(text)) add(findings, 'warn', 'css.text-justify', 'text-align: justify is unsupported/degraded; use left/center/right.', source);
    if (!hasResponsivePath) add(findings, 'error', 'responsive.html-missing', responsive.warnings.join(' '), source, { breakpointCoverage: responsive.breakpointCoverage, parentConstraints: responsive.parentConstraints });
    summaries.push({ source, breakpoints: sig.breakpoints, mediaQueries: sig.mediaQueries, flexibleSignals: sig.flexibleSignals, hasResponsivePath, responsive });
  }
  return summaries;
}

function walkNodes(nodes, fn) {
  const visit = (node, stage) => {
    if (!node || typeof node !== 'object') return;
    fn(node, stage);
    if (Array.isArray(node.children)) node.children.forEach((c) => visit(c, stage));
    if (node.graphicNode) visit(node.graphicNode, stage);
    if (node.clipNode) visit(node.clipNode, stage);
  };
  for (const [stageIndex, stage] of nodes.entries()) {
    for (const root of Array.isArray(stage.rootNodes) ? stage.rootNodes : []) visit(root, stageIndex);
  }
}

function collectInteractions(project) {
  const out = [];
  for (const [stageIndex, st] of project.stages.entries()) {
    for (const ix of [...(Array.isArray(st.interactionSpecs) ? st.interactionSpecs : []), ...(Array.isArray(st.interactions) ? st.interactions : [])]) {
      if (ix && typeof ix === 'object') out.push({ ...ix, stageIndex, nodeId: null, scope: 'stage' });
    }
  }
  walkNodes(project.stages, (node, stageIndex) => {
    for (const ix of [...(Array.isArray(node.interactionSpecs) ? node.interactionSpecs : []), ...(Array.isArray(node.interactions) ? node.interactions : [])]) {
      if (ix && typeof ix === 'object') out.push({ ...ix, stageIndex, nodeId: node.id || null, scope: 'node' });
    }
  });
  return out;
}

function libraryItemMap(project) {
  const byId = new Map();
  for (const item of Array.isArray(project.libraryItems) ? project.libraryItems : []) {
    if (item?.id) byId.set(item.id, item);
  }
  return byId;
}

function itemMatchesDataSource(item, dataSource) {
  if (!item || !dataSource || !['api', 'database'].includes(String(item.assetType || '').toLowerCase())) {
    return false;
  }
  const raw = String(dataSource).trim().toLowerCase();
  const short = raw.replace(/^(api|db|database)\./, '');
  const candidates = [
    item.id,
    item.name,
  ];
  try {
    const config = item.configJson ? JSON.parse(item.configJson) : {};
    candidates.push(config.path, config.table, config.collection, config.name, config.endpoint);
  } catch {
    // Non-JSON config is already suspicious elsewhere; don't fail matching on it.
  }
  return candidates
    .filter(Boolean)
    .some((candidate) => {
      const value = String(candidate).trim().toLowerCase();
      return value === raw || value === short || value.endsWith(`/${short}`);
    });
}

function projectNeedsBackend(projectSummary) {
  if (projectSummary?.dataRepeaterCount > 0) return true;
  return (projectSummary?.interactions || []).some((ix) => {
    const action = String(ix.action || '').toUpperCase();
    return action === 'CALL_API' || action === 'CALL_DATABASE' || action === 'SUBMIT_FORM';
  });
}

function projectNeedsConnector(projectSummary) {
  return (projectSummary?.interactions || []).some((ix) => {
    const action = String(ix.action || '').toUpperCase();
    return BACKEND_REQUIRED_ACTIONS.has(action) || GATED_ACTIONS.has(action);
  });
}

function semanticFieldCount(node) {
  return Object.keys(node).filter((k) => /^semantic[A-Z]/.test(k) || k.startsWith('responsive') || k === 'divisionOverrides').length;
}

async function reviewProject(projectPath, findings, allowStatic) {
  if (!projectPath) return null;
  let project;
  try {
    project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  } catch (e) {
    throw new ReviewError(e.code === 'ENOENT' ? `Project not found: ${projectPath}` : `Project is not valid JSON: ${projectPath}`);
  }
  const source = path.resolve(projectPath);
  if (!project || typeof project !== 'object' || !Array.isArray(project.stages) || !project.stages.length) {
    add(findings, 'error', 'project.stages', 'Project must have non-empty stages[].', source);
    return { source, stages: 0, interactions: [] };
  }
  const libById = libraryItemMap(project);
  const adapters = new Map((project.dataAdapters || []).filter((a) => a?.id).map((a) => [a.id, a]));
  const ids = new Map();
  let nodeCount = 0;
  let semanticFields = 0;
  let overrideNodes = 0;
  let divisionCount = 0;
  let repeaterCount = 0;
  let dataRepeaterCount = 0;
  const repeaters = [];
  for (const [i, st] of project.stages.entries()) {
    if (!Array.isArray(st.rootNodes) || !st.rootNodes.length) add(findings, 'error', 'stage.rootNodes', `Stage ${i} has no rootNodes.`, source);
    divisionCount += Array.isArray(st.divisions) ? st.divisions.length : 0;
  }
  walkNodes(project.stages, (node, stageIndex) => {
    nodeCount++;
    if (node.id) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(node.id)) add(findings, 'error', 'node.id.invalid', `Node id "${node.id}" is not letter-first/stable for Android typed accessors.`, source, { stageIndex });
      if (ids.has(node.id)) add(findings, 'error', 'node.id.duplicate', `Duplicate node id "${node.id}".`, source, { firstStage: ids.get(node.id), stageIndex });
      ids.set(node.id, stageIndex);
    }
    if (node.repeater && node.repeater.enabled === true) {
      repeaterCount++;
      const adapterId = String(node.repeater.adapterId || '').trim();
      const adapter = adapterId ? adapters.get(adapterId) : null;
      const detail = { stageIndex, nodeId: node.id || null, adapterId: adapterId || null };
      const samples = Array.isArray(node.repeater.sampleItems) && node.repeater.sampleItems.length
        ? node.repeater.sampleItems
        : (Array.isArray(adapter?.sampleItems) ? adapter.sampleItems : []);
      if (!samples.length) {
        add(findings, 'warn', 'repeater.sample-items-missing', 'Repeater exports preview rows from repeater or adapter sampleItems; add sample rows so native previews do not keep placeholders.', source, detail);
      }
      if (adapterId && !adapter) {
        add(findings, 'warn', 'repeater.adapter-missing', 'Repeater references a data adapter id that is not present in project.dataAdapters[].', source, detail);
      }
      const dataSource = String(node.repeater.dataSource || adapter?.sourceLibraryItemId || adapter?.collectionPath || '').trim();
      let matchedItem = null;
      if (dataSource) {
        dataRepeaterCount++;
        matchedItem = adapter?.sourceLibraryItemId
          ? libById.get(adapter.sourceLibraryItemId) || null
          : [...libById.values()].find((item) => itemMatchesDataSource(item, dataSource)) || null;
        if (!matchedItem) {
          add(findings, 'warn', 'repeater.datasource-unregistered', 'Repeater data adapter/source should correspond to a registered api/database library item; register it before wiring live data.', source, { ...detail, dataSource });
        }
      }
      repeaters.push({
        ...detail,
        dataSource: dataSource || null,
        registered: Boolean(matchedItem),
        libraryItemId: matchedItem?.id || null,
        assetType: matchedItem?.assetType || null,
        sampleItems: samples.length,
      });
    }
    const sf = semanticFieldCount(node);
    semanticFields += sf;
    if (node.divisionOverrides && typeof node.divisionOverrides === 'object') overrideNodes++;
  });
  const responsive = analyzeProjectResponsiveValue(project, projectPath);
  const hasResponsivePath = responsive.ok;
  if (!hasResponsivePath) add(findings, 'error', 'responsive.project-missing', responsive.warnings.join(' '), source, { breakpointCoverage: responsive.breakpointCoverage, fluidRootCount: responsive.fluidRootCount });
  const interactions = collectInteractions(project);
  for (const ix of interactions) {
    const action = String(ix.action || '').toUpperCase();
    const detail = { stageIndex: ix.stageIndex, nodeId: ix.nodeId, trigger: ix.trigger, action };
    if (action === 'CALL_API') {
      const item = libById.get(ix.targetLibraryItemId);
      if (!item || item.assetType !== 'api') {
        add(findings, 'error', 'library.api-missing', 'CALL_API must target a registered api library item in project.json.', source, detail);
      }
    }
    if (action === 'CALL_DATABASE') {
      const item = libById.get(ix.targetLibraryItemId);
      if (!item || item.assetType !== 'database') {
        add(findings, 'error', 'library.database-missing', 'CALL_DATABASE must target a registered database library item in project.json.', source, detail);
      }
    }
    if (GATED_ACTIONS.has(action)) {
      add(findings, 'error', 'event.action-gated', `${action} requires an explicit sandbox/security policy and may not execute implicitly.`, source, detail);
    } else if (BACKEND_REQUIRED_ACTIONS.has(action)) {
      add(findings, 'warn', 'event.connector-required', `${action} requires connector/delegate implementation before handoff.`, source, detail);
    }
  }
  return { source, stages: project.stages.length, nodeCount, divisionCount, semanticFields, overrideNodes, repeaterCount, dataRepeaterCount, repeaters, hasResponsivePath, responsive, interactions };
}

async function listFiles(root, predicate, max = 2000) {
  const out = [];
  async function walk(dir) {
    if (out.length >= max) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) break;
      if (entry.name === '.git' || entry.name === 'build' || entry.name === '.gradle') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && predicate(full)) out.push(full);
    }
  }
  if (root) await walk(root);
  return out;
}

function architectureApproved(text) {
  return /^-\s*\[[xX]\]\s*User approved this architecture for implementation\.\s*$/m.test(text)
    || /^Approved:\s*(yes|true)\s*$/mi.test(text);
}

async function reviewArchitecture(opts, findings, projectSummary) {
  const required = projectNeedsBackend(projectSummary);
  if (!required && !opts.architecture) return null;
  const candidates = [];
  if (opts.architecture) candidates.push(opts.architecture);
  if (opts.project) candidates.push(path.join(path.dirname(opts.project), 'nativeui-architecture.md'));
  else candidates.push(path.resolve('nativeui-architecture.md'));
  const checked = unique(candidates.map((candidate) => path.resolve(candidate)));
  let source = null;
  let text = '';
  for (const candidate of checked) {
    try {
      text = await fs.readFile(candidate, 'utf8');
      source = candidate;
      break;
    } catch {
      // Try the next explicit/default architecture location.
    }
  }
  if (!source) {
    add(
      findings,
      'error',
      'architecture.missing',
      required
        ? 'Backend-required functionality needs an approved nativeui-architecture.md before implementation or final handoff.'
        : 'The explicitly requested nativeui-architecture.md could not be read.',
      checked[0],
      { checked },
    );
    return { source: checked[0], found: false, approved: false, missingSections: ARCHITECTURE_REQUIRED_HEADINGS };
  }
  const missingSections = ARCHITECTURE_REQUIRED_HEADINGS
    .filter((heading) => !new RegExp(`^##\\s+${heading}\\s*$`, 'mi').test(text));
  if (missingSections.length) {
    add(
      findings,
      'error',
      'architecture.sections-missing',
      'nativeui-architecture.md is missing required sections from the architect contract.',
      source,
      { missingSections },
    );
  }
  const decisions = validateArchitectureDecisions(text);
  if (decisions.errors.length) {
    add(
      findings,
      'error',
      'architecture.decisions-unresolved',
      'nativeui-architecture.md still contains unanswered target, render, hosting, or runtime decisions.',
      source,
      { unresolvedDecisions: decisions.errors },
    );
  }
  if (opts.explicitTargets) {
    const reviewedTargetIds = opts.selectedTargets.map((target) => target.id);
    const missingTargets = reviewedTargetIds.filter((id) => !decisions.targetIds.includes(id));
    if (missingTargets.length) {
      add(
        findings,
        'error',
        'architecture.target-mismatch',
        'The final-review target set is not fully recorded in nativeui-architecture.md.',
        source,
        { reviewedTargetIds, architectureTargetIds: decisions.targetIds, missingTargets },
      );
    }
  }
  const approved = architectureApproved(text);
  if (!approved) {
    add(
      findings,
      'error',
      'architecture.unapproved',
      'nativeui-architecture.md is present but not approved. Check the approval box before backend automation or final handoff.',
      source,
    );
  }
  return {
    source,
    found: true,
    approved,
    missingSections,
    targetIds: decisions.targetIds,
    renderMode: decisions.renderMode,
    unresolvedDecisions: decisions.errors,
  };
}

async function reviewNativeDirs(opts, findings, projectSummary) {
  const roots = [opts.androidDir, opts.iosDir].filter(Boolean);
  const backendFiles = [];
  const androidConnectorFiles = opts.androidDir ? await listFiles(opts.androidDir, (f) => /BackendConnector\.kt$/.test(f)) : [];
  const iosConnectorFiles = opts.iosDir ? await listFiles(opts.iosDir, (f) => /BackendConnector\.swift$/.test(f)) : [];
  const connectorFiles = [...androidConnectorFiles, ...iosConnectorFiles];
  for (const root of roots) backendFiles.push(...await listFiles(root, (f) => /NuiBackend\.(kt|swift)$/.test(f)));
  const backendNeeded = projectNeedsConnector(projectSummary);
  const androidSet = new Set(androidConnectorFiles.map((f) => path.basename(f, '.kt')));
  const iosSet = new Set(iosConnectorFiles.map((f) => path.basename(f, '.swift')));
  if (backendNeeded && roots.length && connectorFiles.length === 0) {
    add(findings, 'error', 'backend.connectors-missing', 'Project has backend-required events but no *BackendConnector.* files were found in exported native dirs.', roots.join(', '));
  }
  if (backendNeeded && (opts.androidDir || opts.iosDir) && (!opts.androidDir || !opts.iosDir)) {
    add(findings, 'error', 'backend.native-target-missing', 'Functionality must be reviewed against BOTH Android and iOS exported dirs.', roots.join(', '));
  }
  if (backendNeeded && opts.androidDir && opts.iosDir) {
    if (!androidConnectorFiles.length) add(findings, 'error', 'backend.android-connectors-missing', 'Android export has no *BackendConnector.kt files for backend-required functionality.', path.resolve(opts.androidDir));
    if (!iosConnectorFiles.length) add(findings, 'error', 'backend.ios-connectors-missing', 'iOS export has no *BackendConnector.swift files for backend-required functionality.', path.resolve(opts.iosDir));
    const androidOnly = [...androidSet].filter((name) => !iosSet.has(name));
    const iosOnly = [...iosSet].filter((name) => !androidSet.has(name));
    if (androidOnly.length || iosOnly.length) {
      add(findings, 'error', 'backend.connector-parity', 'Android and iOS connector class sets must match for identical native functionality.', roots.join(', '), { androidOnly, iosOnly });
    }
  }
  const delegatorLogicPatterns = /\b(URLSession|OkHttp|HttpURLConnection|fetch\s*\(|Firestore|Supabase|setOnClickListener|addAction\s*\(|executeQuery|SELECT\s+|INSERT\s+|DELETE\s+FROM)\b/i;
  const generatedLogicPatterns = /\b(URLSession|OkHttp|HttpURLConnection|fetch\s*\(|Firestore|Supabase|executeQuery|SELECT\s+|INSERT\s+|DELETE\s+FROM)\b/i;
  for (const file of backendFiles) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    if (delegatorLogicPatterns.test(text)) {
      add(findings, 'error', 'backend.logic-in-delegator', 'NuiBackend contains app/backend logic; move it into a *BackendConnector.* class and leave NuiBackend as delegation only.', path.resolve(file));
    }
  }
  for (const root of roots) {
    const generatedFiles = await listFiles(root, (f) => {
      const base = path.basename(f);
      return /^Generated/.test(base) || /^NuiScreen(?:Controls|Delegate)\./.test(base) || base === 'MainActivity.kt' || base === 'activity_main.xml';
    });
    for (const file of generatedFiles) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (generatedLogicPatterns.test(text)) {
        add(findings, 'error', 'backend.logic-in-generated', 'Generated UI/contract files contain app/backend logic; generated files are read-only.', path.resolve(file));
      }
    }
  }
  return {
    backendFiles: backendFiles.map((f) => path.resolve(f)),
    connectorFiles: connectorFiles.map((f) => path.resolve(f)),
    androidConnectorFiles: androidConnectorFiles.map((f) => path.resolve(f)),
    iosConnectorFiles: iosConnectorFiles.map((f) => path.resolve(f)),
  };
}

async function reviewSelectedTargets(opts, findings) {
  if (!opts.explicitTargets) return [];
  const reviews = [];
  for (const target of opts.selectedTargets) {
    const rootValue = opts.targetDirs[target.id]
      || (target.platform === 'android' ? opts.androidDir : target.platform === 'ios' ? opts.iosDir : '');
    if (!rootValue) {
      add(findings, 'error', 'target.export-missing', `No exported directory was supplied for ${target.id}.`, target.id);
      reviews.push({ targetId: target.id, found: false });
      continue;
    }
    const suppliedRoot = path.resolve(rootValue);
    let root;
    let record;
    try {
      const resolved = resolveManifestTargetRoots(suppliedRoot, [target.id]);
      root = resolved.roots.get(target.id);
      record = readExportManifest(root, { targetId: target.id, requireDeclaredFiles: true });
    } catch (error) {
      const message = error?.message || String(error);
      const missingDeclared = /Declared file is missing:/.test(message);
      const missingManifest = /No schema-2 nativeui-export-manifest\.json was found/.test(message);
      const mismatch = /does not contain the requested lane|manifest declares/.test(message);
      const code = missingDeclared ? 'target.declared-file-missing'
        : missingManifest ? 'target.manifest-missing'
          : mismatch ? 'target.manifest-mismatch'
          : 'target.manifest-invalid';
      add(findings, 'error', code, `${target.id} export manifest failed review: ${message}`, suppliedRoot);
      reviews.push({ targetId: target.id, found: true, manifest: false });
      continue;
    }
    const manifestPath = record.path;
    const manifest = record.manifest;
    const files = await listFiles(root, () => true);
    const normalized = files.map((file) => path.relative(root, file).replaceAll(path.sep, '/'));
    const declaredWriteOnce = new Set(record.writeOnceFiles);
    for (const seam of target.writeOnceFiles) {
      const normalizedSeam = seam.replaceAll('\\', '/');
      const pattern = `^${normalizedSeam.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`;
      const matches = [...declaredWriteOnce].some((file) => {
        const candidate = normalizedSeam.includes('/') ? file : path.posix.basename(file);
        return new RegExp(pattern).test(candidate);
      });
      if (!matches) {
        add(
          findings,
          'error',
          'target.write-once-undeclared',
          `${target.id} manifest does not declare its durable logic seam ${seam}.`,
          manifestPath,
        );
      }
    }
    const markers = {
      'rust-ios': ['scripts/build-ios.sh'], 'rust-android': ['scripts/build-android.sh'],
      'rust-web': ['scripts/build-web.sh'], 'web-html': ['manifest.webmanifest', 'sw.js', 'app-actions.js'],
      'web-react': ['package.json', 'react-router.config.ts', 'app/seams/app-actions.ts'],
      'web-vue': ['package.json', 'nuxt.config.ts', 'app/seams/app-actions.ts'],
      'web-angular': ['package.json', 'angular.json', 'src/app/seams/app-actions.ts'],
      'web-astro': ['package.json', 'astro.config.ts', 'src/seams/app-actions.ts'],
      'csharp-ios': ['Nui.Rt.iOS.csproj'], 'csharp-android': ['Nui.Rt.Android.csproj'],
    }[target.id] || [];
    for (const marker of markers) {
      if (!normalized.some((file) => file === marker || file.endsWith(`/${marker}`))) {
        add(findings, 'error', 'target.host-missing', `${target.id} is missing required generated host artifact ${marker}.`, root);
      }
    }
    reviews.push({
      targetId: target.id,
      found: true,
      manifest: true,
      manifestSchemaVersion: manifest.schemaVersion,
      renderModes: manifest.renderModes?.[target.id] || [],
      declaredFiles: record.generatedFiles.length + record.writeOnceFiles.length,
      root,
      releaseStatus: target.releaseStatus,
    });
  }
  return reviews;
}

async function reviewIntake(intakePath, findings) {
  if (!intakePath) return null;
  let bundle;
  try {
    bundle = JSON.parse(await fs.readFile(intakePath, 'utf8'));
  } catch (e) {
    throw new ReviewError(e.code === 'ENOENT' ? `Intake bundle not found: ${intakePath}` : `Intake bundle is not valid JSON: ${intakePath}`);
  }
  const gaps = Array.isArray(bundle.gaps) ? bundle.gaps : [];
  for (const gap of gaps) {
    add(findings, 'warn', 'intake.gap', gap.message || 'Unresolved intake gap.', path.resolve(intakePath), { code: gap.code, source: gap.source });
  }
  return { source: path.resolve(intakePath), gapCount: gaps.length, confidence: bundle.overallConfidence };
}

async function reviewDynamicFlow(opts, findings) {
  const inputs = [...opts.html, ...(opts.project ? [opts.project] : [])];
  if (!inputs.length) return null;
  const report = await auditFlowInputs(inputs);
  for (const item of report.inputs) {
    for (const issue of item.issues) add(findings, 'error', issue.code, issue.message, item.input, issue.detail);
  }
  for (const issue of report.issues) add(findings, 'error', issue.code, issue.message, inputs.map((input) => path.resolve(input)).join(', '), issue.detail);
  return report;
}

async function loadInstructions(value) {
  if (!value) return null;
  const candidate = value.startsWith('@') ? value.slice(1) : value;
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      const text = await fs.readFile(candidate, 'utf8');
      return { source: path.resolve(candidate), text, mode: 'file' };
    }
  } catch {
    // Treat non-files as inline instruction text.
  }
  return { source: 'inline', text: value, mode: 'inline' };
}

function instructionSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function hasExplicitProhibition(text, terms) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const blockers = "(?:no|without|avoid|do not|don't|should not|must not|never)";
  const termPattern = terms.join('|');
  const before = new RegExp(`\\b${blockers}\\b[^.?!]{0,100}\\b(?:${termPattern})\\b`, 'i');
  const after = new RegExp(`\\b(?:${termPattern})\\b[^.?!]{0,60}\\b${blockers}\\b`, 'i');
  return before.test(t) || after.test(t);
}

function hasLiveDataIntent(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const positivePatterns = [
    /\b(?:live|real|dynamic|remote|server|api|database|db)[ -]?(?:backed\s+)?(?:data|list|feed|results|rows|records)\b/i,
    /\b(?:data|list|feed|results|rows|records|items)\s+(?:from|via|using|backed\s+by|powered\s+by)\s+(?:an?\s+)?(?:api|database|db|server|backend)\b/i,
    /\b(?:api|database|db|server|backend|remote|data)-backed\b/i,
    /\b(?:fetch|load|sync|query)\s+(?:live|real|dynamic|remote|server\s+)?(?:data|results|items|rows|records|feed|list)\b/i,
    /\b(?:connect|wire)\s+(?:the\s+)?(?:list|feed|results|repeater|data)\s+(?:to|into)\s+(?:an?\s+)?(?:api|database|db|server|backend)\b/i,
    /\brepeater\b[^.?!]{0,80}\b(?:api|database|db|data source|datasource)\b/i,
    /\b(?:data source|datasource)\b/i,
  ];
  return positivePatterns.some((re) => re.test(t))
    && !hasExplicitProhibition(text, ['live data', 'dynamic data', 'real data', 'data source', 'datasource']);
}

async function reviewInstructions(instructionArg, findings, projectSummary, nativeSummary) {
  const loaded = await loadInstructions(instructionArg);
  if (!loaded) {
    add(findings, 'info', 'instructions.missing', 'No user instructions were provided to the final review; manually confirm product intent before handoff.');
    return null;
  }
  const text = loaded.text || '';
  const interactions = projectSummary?.interactions || [];
  const backendActions = interactions.filter((ix) => {
    const action = String(ix.action || '').toUpperCase();
    return BACKEND_REQUIRED_ACTIONS.has(action);
  });
  if (hasExplicitProhibition(text, ['events?', 'interactions?', 'handlers?', 'clicks?', 'scripts?', 'javascript'])) {
    if (interactions.length) {
      add(findings, 'error', 'instructions.events-forbidden', 'User instructions explicitly prohibit events/interactions, but project contains authored interactions.', loaded.source, { count: interactions.length });
    }
  }
  if (hasExplicitProhibition(text, ['backend', 'api', 'apis', 'network', 'server', 'database', 'db', 'http'])) {
    if (backendActions.length) {
      add(findings, 'error', 'instructions.backend-forbidden', 'User instructions explicitly prohibit backend/API/network work, but project contains backend-required interactions.', loaded.source, { count: backendActions.length });
    }
  }
  const unregisteredLiveRepeaters = (projectSummary?.repeaters || [])
    .filter((r) => r.dataSource && !r.registered);
  if (unregisteredLiveRepeaters.length && hasLiveDataIntent(text)) {
    add(findings, 'error', 'repeater.datasource-live-unregistered', 'User asked for live/data-backed content, but at least one repeater dataSource is not registered as an api/database library item.', loaded.source, { repeaters: unregisteredLiveRepeaters });
  }
  const wantsBothNative = /\b(?:both\s+)?(?:ios\s*(?:and|\/|\+|&)\s*android|android\s*(?:and|\/|\+|&)\s*ios)\b/i.test(text);
  const wantsNative = wantsBothNative || /\b(?:ios|android|native|emulator|simulator)\b/i.test(text);
  if (wantsBothNative && (!nativeSummary?.androidDir || !nativeSummary?.iosDir)) {
    add(findings, 'warn', 'instructions.native-targets-missing', 'User instructions mention both iOS and Android, but final review did not receive both exported native dirs.', loaded.source);
  } else if (wantsNative && !nativeSummary?.androidDir && !nativeSummary?.iosDir) {
    add(findings, 'warn', 'instructions.native-dirs-missing', 'User instructions mention native verification, but no exported native dirs were provided to final review.', loaded.source);
  }
  return {
    source: loaded.source,
    mode: loaded.mode,
    summary: instructionSummary(text),
    characters: text.length,
  };
}

function human(report) {
  const lines = [];
  lines.push(`NativeUI final review: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`Errors: ${report.summary.errors}, warnings: ${report.summary.warnings}, info: ${report.summary.info}`);
  if (report.architecture) lines.push(`Architecture reviewed: ${report.architecture.source}`);
  if (report.instructions) lines.push(`Instructions reviewed: ${report.instructions.summary}`);
  for (const f of report.findings) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.code}: ${f.message}${f.source ? ` (${f.source})` : ''}`);
  }
  if (!report.findings.length) lines.push('- No findings.');
  return lines.join('\n') + '\n';
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const findings = [];
    if (opts.allowStatic) add(findings, 'warn', 'responsive.static-opt-out-ignored', '--allow-static is a deprecated audit option retained only for CLI compatibility; it cannot bypass responsive review and is unrelated to static web build/hosting mode.', 'command-line');
    const intake = await reviewIntake(opts.intake, findings);
    const html = await reviewHtml(opts.html, findings, opts.allowStatic);
    const project = await reviewProject(opts.project, findings, opts.allowStatic);
    const flow = await reviewDynamicFlow(opts, findings);
    const architecture = await reviewArchitecture(opts, findings, project);
    const native = await reviewNativeDirs(opts, findings, project);
    const targets = await reviewSelectedTargets(opts, findings);
    if (opts.androidDir) native.androidDir = path.resolve(opts.androidDir);
    if (opts.iosDir) native.iosDir = path.resolve(opts.iosDir);
    const instructions = await reviewInstructions(opts.instructions, findings, project, native);
    const summary = {
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };
    const report = {
      version: 1,
      createdAt: new Date().toISOString(),
      tool: 'nui-final-review',
      ok: summary.errors === 0,
      allowStatic: opts.allowStatic,
      instructions,
      architecture,
      summary,
      intake,
      html,
      project,
      flow,
      native,
      targets,
      findings,
    };
    const payload = opts.format === 'human' ? human(report) : JSON.stringify(report, null, 2);
    if (opts.out) {
      const outPath = path.resolve(opts.out);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, payload);
      process.stdout.write(`Wrote final review -> ${outPath}\n`);
    } else {
      process.stdout.write(payload);
    }
    if (!report.ok) process.exit(1);
  } catch (err) {
    if (err instanceof ReviewError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export { parseArgs, reviewSelectedTargets };
