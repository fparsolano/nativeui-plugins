#!/usr/bin/env node
// nui-connectors-plan.mjs - plan durable backend connector classes for NativeUI.
//
// Reads project.json and emits one connector plan per stage. NuiBackend.kt and
// NuiBackend.swift should stay thin write-once delegators; app/backend logic
// belongs in generated-by-agent connector classes such as LoginBackendConnector.
//
// Usage:
//   node bin/nui-connectors-plan.mjs [project.json] [--json|--human] [-o plan.json]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTargets } from './target-contract.mjs';

class ConnectorPlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConnectorPlanError';
  }
}

const USAGE = 'Usage: node bin/nui-connectors-plan.mjs [project.json] [--json|--human] [--target auto|<target-id|group>...] [--all-targets] [--platform android|ios|both|rust|web] [-o plan.json]';
const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in',
  'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw',
  'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);
const SWIFT_KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import',
  'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public',
  'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default',
  'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return',
  'switch', 'where', 'while', 'as', 'Any', 'catch', 'false', 'is', 'nil', 'rethrows',
  'super', 'self', 'Self', 'throw', 'throws', 'true', 'try',
]);

function parseArgs(argv) {
  let project = './project.json';
  let format = 'json';
  let out = '';
  let platform = 'both';
  const targetTokens = [];
  let allTargets = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      format = 'json';
    } else if (a === '--human') {
      format = 'human';
    } else if (a === '--platform' || a === '-p') {
      platform = String(argv[++i] || '').toLowerCase();
      if (!['android', 'ios', 'both', 'rust', 'web'].includes(platform)) {
        throw new ConnectorPlanError(`--platform must be android|ios|both|rust|web (got '${platform}').`);
      }
    } else if (a === '--target') {
      targetTokens.push(String(argv[++i] || '').toLowerCase());
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === '-o' || a === '--output') {
      out = argv[++i];
      if (!out) throw new ConnectorPlanError('-o requires a path argument.');
    } else if (a === '-h' || a === '--help') {
      throw new ConnectorPlanError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ConnectorPlanError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (project === './project.json') {
      project = a;
    } else {
      throw new ConnectorPlanError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  const explicitTargets = targetTokens.length || allTargets;
  const selectedTargets = explicitTargets
    ? resolveTargets(targetTokens, { allTargets, defaults: true })
    : [];
  return { project, format, out, platform, selectedTargets, explicitTargets };
}

function slugParts(value) {
  const parts = String(value || 'Screen')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts.length ? parts : ['Screen'];
}

function pascalCase(value) {
  return slugParts(value).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function camelCase(id, keywords = new Set()) {
  const parts = slugParts(id);
  let name = parts
    .map((p, i) => {
      const clean = p.replace(/[^A-Za-z0-9]/g, '');
      if (i === 0) return clean.charAt(0).toLowerCase() + clean.slice(1);
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join('');
  if (!/^[A-Za-z_]/.test(name)) name = `n${name}`;
  if (keywords.has(name)) name = `${name}View`;
  return name || 'view';
}

function letterFirst(id) {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(String(id || ''));
}

function walkNodes(nodes, fn) {
  const visit = (node, ancestry = []) => {
    if (!node || typeof node !== 'object') return;
    fn(node, ancestry);
    const next = [...ancestry, node.id || node.kind || '?'];
    if (Array.isArray(node.children)) node.children.forEach((c) => visit(c, next));
    if (node.graphicNode) visit(node.graphicNode, next);
    if (node.clipNode) visit(node.clipNode, next);
  };
  for (const n of Array.isArray(nodes) ? nodes : []) visit(n, []);
}

function collectControls(stage) {
  const controls = [];
  const seen = new Set();
  walkNodes(stage.rootNodes, (node) => {
    if (!node.id || seen.has(node.id)) return;
    seen.add(node.id);
    controls.push({
      id: node.id,
      kind: node.kind || 'unknown',
      androidAccessor: letterFirst(node.id) ? camelCase(node.id, KOTLIN_KEYWORDS) : null,
      iosAccessor: camelCase(node.id, SWIFT_KEYWORDS),
      androidTyped: letterFirst(node.id),
      role: roleForKind(node.kind),
    });
  });
  return controls;
}

function roleForKind(kind = '') {
  if (/Button|Hyperlink/.test(kind)) return 'action';
  if (/TextField|PasswordField|TextArea|ComboBox|CheckBox|RadioButton|Slider/.test(kind)) return 'input';
  if (/Label|Text$/.test(kind)) return 'text-output';
  if (/ImageView|shape|Rectangle|Circle|Path|Line|Polygon|Polyline/.test(kind)) return 'visual';
  return 'container';
}

function collectStageInteractions(stage) {
  const out = [];
  for (const ix of Array.isArray(stage.interactions) ? stage.interactions : []) {
    if (ix && typeof ix === 'object') out.push({ ...normalizeInteraction(ix), scope: 'stage', nodeId: null });
  }
  walkNodes(stage.rootNodes, (node) => {
    for (const ix of Array.isArray(node.interactions) ? node.interactions : []) {
      if (ix && typeof ix === 'object') out.push({ ...normalizeInteraction(ix), scope: 'node', nodeId: node.id || null });
    }
  });
  return out;
}

function normalizeInteraction(ix) {
  return {
    id: ix.id,
    trigger: ix.trigger || '',
    action: ix.action || '',
    target: ix.targetLibraryItemId || ix.targetNodeId || ix.targetStageId || ix.target || '',
    params: ix.params && typeof ix.params === 'object' ? ix.params : {},
  };
}

function indexLibraryItems(project) {
  const byId = new Map();
  for (const item of Array.isArray(project.libraryItems) ? project.libraryItems : []) {
    if (item && typeof item.id === 'string') byId.set(item.id, item);
  }
  return byId;
}

function parseConfigJson(item) {
  if (!item || typeof item.configJson !== 'string' || !item.configJson.trim()) return {};
  try {
    const parsed = JSON.parse(item.configJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function dataSourceCandidates(item) {
  const cfg = parseConfigJson(item);
  return [item?.id, item?.name, cfg.path, cfg.url, cfg.endpoint, cfg.table, cfg.collection, cfg.name]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());
}

function resolveDataSourceItem(dataSource, libById) {
  const raw = String(dataSource || '').trim().toLowerCase();
  if (!raw) return null;
  if (libById.has(dataSource)) return libById.get(dataSource);
  const short = raw.replace(/^(api|db|database)\./, '');
  for (const item of libById.values()) {
    if (!['api', 'database'].includes(String(item.assetType || '').toLowerCase())) continue;
    if (dataSourceCandidates(item).some((v) => v === raw || v === short || v.endsWith(`/${short}`))) return item;
  }
  return null;
}

function indexDataAdapters(project) {
  const out = new Map();
  for (const adapter of Array.isArray(project?.dataAdapters) ? project.dataAdapters : []) {
    if (adapter?.id) out.set(String(adapter.id), adapter);
  }
  return out;
}

function repeaterSource(repeater, adapters, libById) {
  const adapterId = String(repeater?.adapterId || '').trim();
  const adapter = adapterId ? adapters.get(adapterId) : null;
  const dataSource = String(repeater?.dataSource || adapter?.sourceLibraryItemId || adapter?.collectionPath || '').trim();
  const item = adapter?.sourceLibraryItemId
    ? resolveDataSourceItem(adapter.sourceLibraryItemId, libById)
    : resolveDataSourceItem(dataSource, libById);
  return { adapterId: adapterId || null, adapter, dataSource, item };
}

function collectRepeaters(stage, libById, adapters) {
  const out = [];
  walkNodes(stage.rootNodes, (node) => {
    if (!node?.repeater || node.repeater.enabled !== true) return;
    const source = repeaterSource(node.repeater, adapters, libById);
    const sampleItems = Array.isArray(node.repeater.sampleItems)
      ? node.repeater.sampleItems.length
      : (Array.isArray(source.adapter?.sampleItems) ? source.adapter.sampleItems.length : 0);
    out.push({
      nodeId: node.id || null,
      adapterId: source.adapterId,
      dataSource: source.dataSource || null,
      collectionPath: source.adapter?.collectionPath || null,
      itemName: node.repeater.itemName || source.adapter?.itemName || 'item',
      previewCount: node.repeater.previewCount || null,
      sampleItems,
      libraryItemId: source.item?.id || null,
      assetType: source.item?.assetType || null,
      registered: Boolean(source.item),
      runtimeBindingKey: source.adapterId || source.dataSource || node.id || null,
      runtimeHelpers: source.adapterId || source.dataSource || node.id ? {
        android: `controls.bindRepeater("${escapeSnippet(source.adapterId || source.dataSource || node.id)}", rows)`,
        ios: `controls.bindRepeater("${escapeSnippet(source.adapterId || source.dataSource || node.id)}", rows)`,
      } : null,
    });
  });
  return out;
}

function escapeSnippet(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toPath(raw, fallback) {
  let s = String(raw || '').trim();
  if (!s) return fallback;
  const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  if (m) s = m[1] || '/';
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\s+/g, '-').replace(/[^A-Za-z0-9/_\-.:{}]/g, '') || fallback;
}

function normMethod(value, fallback = 'GET') {
  const s = String(value || '').toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(s) ? s : fallback;
}

function deriveBackendNeeds(interactions, repeaters, libById) {
  const endpoints = [];
  const databases = [];
  const events = [];
  const endpointSeen = new Set();
  const databaseSeen = new Set();
  for (const ix of interactions) {
    const action = String(ix.action || '').toUpperCase();
    const params = ix.params || {};
    const item = libById.get(ix.target);
    const cfg = parseConfigJson(item);
    if (action === 'CALL_API') {
      const name = item?.name || ix.target || ix.id || 'api';
      const path_ = toPath(cfg.path || cfg.url || cfg.endpoint || params.path || params.url || name, `/${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      const method = normMethod(cfg.method || params.method, 'GET');
      const key = `${method} ${path_}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        endpoints.push({ method, path: path_, name, target: ix.target, source: item ? `libraryItem:${item.id}` : `${ix.scope}:${ix.nodeId || 'stage'}` });
      }
    } else if (action === 'SUBMIT_FORM') {
      const method = normMethod(params.method, 'POST');
      const path_ = toPath(params.action, '/submit');
      const key = `${method} ${path_}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        endpoints.push({ method, path: path_, name: `form submit ${path_}`, target: params.action || '', source: `${ix.scope}:${ix.nodeId || 'stage'}` });
      }
    } else if (action === 'CALL_DATABASE') {
      const name = item?.name || ix.target || 'database';
      const op = String(cfg.operation || cfg.op || params.operation || params.op || 'query').toLowerCase();
      const key = `${op}:${name}`;
      if (!databaseSeen.has(key)) {
        databaseSeen.add(key);
        databases.push({ op, name, collection: cfg.table || cfg.collection || cfg.name, target: ix.target, source: item ? `libraryItem:${item.id}` : `${ix.scope}:${ix.nodeId || 'stage'}` });
      }
    }
    if (['RUN_SCRIPT', 'OPEN_URL', 'SUBMIT_FORM', 'SET_STATE', 'CALL_API', 'CALL_DATABASE', 'PLAY_TIMELINE'].includes(action)) {
      events.push(ix);
    }
  }
  for (const repeater of repeaters) {
    if (!repeater.dataSource) continue;
    const item = resolveDataSourceItem(repeater.dataSource, libById);
    if (!item) continue;
    const cfg = parseConfigJson(item);
    const target = repeater.dataSource;
    const source = `repeater:${repeater.nodeId || 'unknown'}`;
    if (String(item.assetType || '').toLowerCase() === 'api') {
      const name = item.name || item.id || target;
      const path_ = toPath(cfg.path || cfg.url || cfg.endpoint || target, `/${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      const method = normMethod(cfg.method, 'GET');
      const key = `${method} ${path_}`;
      if (!endpointSeen.has(key)) {
        endpointSeen.add(key);
        endpoints.push({ method, path: path_, name, target, source });
      }
    } else if (String(item.assetType || '').toLowerCase() === 'database') {
      const name = item.name || item.id || target;
      const op = String(cfg.operation || cfg.op || 'query').toLowerCase();
      const key = `${op}:${name}`;
      if (!databaseSeen.has(key)) {
        databaseSeen.add(key);
        databases.push({ op, name, collection: cfg.table || cfg.collection || cfg.name, target, source });
      }
    }
  }
  return { endpoints, databases, events };
}

function buildPlan(project, projectPath) {
  const libById = indexLibraryItems(project);
  const adapters = indexDataAdapters(project);
  const usedConnectorNames = new Map();
  const connectors = [];
  for (const [index, stage] of project.stages.entries()) {
    const baseName = pascalCase(stage.name || stage.stageId || `Screen${index + 1}`);
    const count = (usedConnectorNames.get(baseName) || 0) + 1;
    usedConnectorNames.set(baseName, count);
    const connectorName = `${baseName}${count > 1 ? count : ''}BackendConnector`;
    const interactions = collectStageInteractions(stage);
    const repeaters = collectRepeaters(stage, libById, adapters);
    const needs = deriveBackendNeeds(interactions, repeaters, libById);
    connectors.push({
      stageIndex: index,
      screenName: stage.name || `Screen ${index + 1}`,
      stageId: stage.stageId || null,
      connectorName,
      android: {
        className: connectorName,
        targetPath: `<android-export>/app/src/main/kotlin/<package-path>/${connectorName}.kt`,
        registerIn: '**/NuiBackend.kt',
        registrationSnippet: `private val ${camelCase(connectorName)} = ${connectorName}()`,
      },
      ios: {
        className: connectorName,
        targetPath: `<ios-export>/App/${connectorName}.swift`,
        registerIn: '**/NuiBackend.swift',
        registrationSnippet: `private let ${camelCase(connectorName)} = ${connectorName}()`,
      },
      controls: collectControls(stage),
      interactions,
      endpoints: needs.endpoints,
      databases: needs.databases,
      repeaters,
      connectorEvents: needs.events,
      notes: [
        'Keep app/backend logic in this connector on both platforms.',
        'NuiBackend.* should instantiate/register/delegate only.',
      ],
    });
  }
  const plan = {
    version: 1,
    createdAt: new Date().toISOString(),
    tool: 'nui-connectors-plan',
    projectPath: path.resolve(projectPath),
    backendBoundary: {
      generatedFiles: ['MainActivity.kt', 'Generated*.swift', 'NuiScreenControls.*', 'NuiScreenDelegate.*', 'GeneratedInteractions.*'],
      delegators: ['NuiBackend.kt', 'NuiBackend.swift'],
      durableAppCode: ['*BackendConnector.kt', '*BackendConnector.swift'],
      rule: 'Generated UI/contract files are never edited. NuiBackend files remain thin write-once delegators. Durable backend logic lives in connector classes.',
    },
    connectors,
    summary: {
      connectorCount: connectors.length,
      controls: connectors.reduce((sum, c) => sum + c.controls.length, 0),
      endpoints: connectors.reduce((sum, c) => sum + c.endpoints.length, 0),
      databases: connectors.reduce((sum, c) => sum + c.databases.length, 0),
      repeaters: connectors.reduce((sum, c) => sum + c.repeaters.length, 0),
      events: connectors.reduce((sum, c) => sum + c.connectorEvents.length, 0),
    },
  };
  // Additive: the secondary Rust target has ONE write-once seam (src/app_actions.rs) instead of a
  // per-stage/per-platform connector pair. Collapse the same derived needs into the NuiBackend hooks to
  // implement there. Present on the JSON plan for every platform; the human view shows it for --platform rust.
  plan.rust = buildRustPlan(plan);
  plan.targetPlans = [];
  return plan;
}

function attachTargetPlans(plan, targets) {
  plan.selectedTargets = targets.map((target) => target.id);
  plan.targetPlans = targets.map((target) => {
    const shared = {
      targetId: target.id,
      releaseStatus: target.releaseStatus,
      generatedUi: target.generatedUi,
      logicType: target.logicType,
      writeOnceFiles: target.writeOnceFiles,
      endpoints: plan.connectors.flatMap((connector) => connector.endpoints),
      databases: plan.connectors.flatMap((connector) => connector.databases),
      repeaters: plan.connectors.flatMap((connector) => connector.repeaters),
    };
    if (target.platform === 'rust') return { ...shared, seam: plan.rust };
    if (target.platform === 'csharp') return {
      ...shared,
      seam: { file: 'AppActions.cs', asyncContract: 'ValueTask<NuiActionResult> HandleAsync(NuiActionContext, CancellationToken)', compatibility: 'INuiBackend On* methods remain valid through the generated adapter' },
    };
    if (target.platform === 'web') return { ...shared, seam: buildWebSeamPlan(target) };
    if (target.id === 'ios-swiftui') return { ...shared, seam: { file: 'App/Services/AppActions.swift', asyncContract: 'async throws -> NuiActionResult' } };
    if (target.id === 'android-compose') return { ...shared, seam: { file: 'NuiAppActionsImpl.kt', asyncContract: 'suspend fun handle(context): NuiActionResult' } };
    return {
      ...shared,
      seam: { files: target.writeOnceFiles, connectors: plan.connectors.map((connector) => target.platform === 'ios' ? connector.ios : connector.android) },
    };
  });
  return plan;
}

function findDeclaredSeam(target, basename) {
  return (Array.isArray(target.writeOnceFiles) ? target.writeOnceFiles : [])
    .find((file) => path.posix.basename(file) === basename) || null;
}

function buildWebSeamPlan(target) {
  const typed = target.id !== 'web-html';
  const extension = typed ? '.ts' : '.js';
  const appActionsFile = findDeclaredSeam(target, `app-actions${extension}`);
  const dataAdaptersFile = findDeclaredSeam(target, `data-adapters${extension}`);
  const customComponentsFile = findDeclaredSeam(target, `custom-components${extension}`);
  const seamDir = path.posix.dirname(appActionsFile || '.');
  return {
    language: typed ? 'TypeScript' : 'JavaScript',
    files: [appActionsFile, dataAdaptersFile, customComponentsFile].filter(Boolean),
    appActionsFile,
    dataAdaptersFile,
    customComponentsFile,
    generatedContractFile: typed
      ? path.posix.join(seamDir, 'contracts.ts')
      : 'contracts.d.ts',
    asyncContract: 'Promise<ActionResult>',
    directBehavior: ['navigation', 'local state', 'visibility', 'selection', 'forms', 'timelines'],
    responsibilities: {
      appActions: 'External effects and application-owned action handling.',
      dataAdapters: 'Live data loading and mapping.',
      customComponents: 'Explicit hand-authored component integration.',
    },
    preservation: {
      implementations: 'Preserved during re-export.',
      generatedContract: 'Regenerated during re-export.',
      changedContract: 'Written beside a preserved implementation as a .new candidate.',
    },
  };
}

// Map the mobile connector-plan's derived needs onto the Rust lane's single-seam NuiBackend hook set.
// Interactions are export-compiled to TapActions in this lane, so the plan is "which of the 11 hooks to
// implement in src/app_actions.rs (and with which targets)", not per-node connector classes.
const RUST_ACTION_TO_HOOK = {
  CALL_API: 'on_call_api',
  SUBMIT_FORM: 'on_submit_form',
  CALL_DATABASE: 'on_call_database',
  OPEN_URL: 'on_open_url',
  SET_STATE: 'on_set_state',
  RUN_SCRIPT: 'on_run_script',
  PLAY_TIMELINE: 'on_play_timeline',
  ANIMATE_PANEL: 'on_animate_panel',
  NAVIGATE_TO_STAGE: 'on_navigate_to_stage',
};

function buildRustPlan(plan) {
  const hooks = new Map();
  const need = (hook) => {
    if (!hooks.has(hook)) hooks.set(hook, new Set());
    return hooks.get(hook);
  };
  for (const c of plan.connectors) {
    for (const e of c.endpoints) {
      const isForm = /^form submit/i.test(e.name || '');
      need(isForm ? 'on_submit_form' : 'on_call_api').add(
        `${e.method} ${e.path}${e.target ? ` (target: ${e.target})` : ''}`
      );
    }
    for (const d of c.databases) need('on_call_database').add(`${d.op}: ${d.collection || d.name}`);
    for (const ev of c.connectorEvents || []) {
      const hook = RUST_ACTION_TO_HOOK[String(ev.action || '').toUpperCase()];
      if (hook) need(hook).add(`${ev.trigger || '?'}/${ev.action}${ev.nodeId ? ` @${ev.nodeId}` : ''}`);
    }
    for (const r of c.repeaters || []) {
      if (r.dataSource) need('fetch_list').add(`${r.nodeId || '?'} <- ${r.dataSource}`);
    }
  }
  const hookList = [...hooks.entries()]
    .map(([hook, set]) => ({ hook, targets: [...set] }))
    .sort((a, b) => a.hook.localeCompare(b.hook));
  return {
    seamFile: 'src/app_actions.rs',
    trait: 'nui_rt::actions::NuiBackend',
    implType: 'AppActions',
    model:
      'ONE write-once seam (no per-stage connector twin, no per-platform pair). Interactions are export-compiled to TapActions — implement hooks and route by target; never attach listeners.',
    controls:
      'read-only: on_screen_ready(controls) -> controls.node(id) -> Option<&SceneNode>. A renamed id is a silent None; change appearance in the design, not at runtime.',
    hooks: hookList,
    notes: [
      'All 11 NuiBackend methods default to a no-op; implement only the hooks listed above.',
      'Rust routes OPEN_URL/SUBMIT_FORM/SET_STATE/RUN_SCRIPT to REAL hooks (a superset of the mobile 5).',
      'fetch_list is SYNCHRONOUS (blocks the render thread; no async executor / no loading-state pane) — debounce/cache in your impl.',
      'HTTP: add reqwest/ureq to Cargo.toml; localhost reaches a dev server directly on host + iOS Simulator (no 10.0.2.2 / no ATS). Keep secrets out of shipped source.',
    ],
    contractDoc: 'docs/rust-backend-contract.md',
  };
}

function human(plan) {
  const lines = [];
  lines.push('NativeUI connector plan');
  lines.push(`Project: ${plan.projectPath}`);
  lines.push(`Connectors: ${plan.summary.connectorCount}`);
  for (const c of plan.connectors) {
    lines.push('');
    lines.push(`- ${c.connectorName} (${c.screenName})`);
    lines.push(`  Android: ${c.android.targetPath}`);
    lines.push(`  iOS:     ${c.ios.targetPath}`);
    lines.push(`  Controls: ${c.controls.map((x) => x.id).slice(0, 12).join(', ') || '(none)'}`);
    lines.push(`  Endpoints: ${c.endpoints.map((e) => `${e.method} ${e.path}`).join(', ') || '(none)'}`);
    lines.push(`  Databases: ${c.databases.map((d) => `${d.op}:${d.collection || d.name}`).join(', ') || '(none)'}`);
    lines.push(`  Repeaters: ${c.repeaters.map((r) => `${r.nodeId || '?'}->${r.dataSource || '(none)'}`).join(', ') || '(none)'}`);
    for (const r of c.repeaters) {
      if (r.runtimeHelpers) {
        lines.push(`    ${r.nodeId || '?'} bind helper: Android ${r.runtimeHelpers.android}; iOS ${r.runtimeHelpers.ios}`);
      }
    }
    if (c.connectorEvents.length) lines.push(`  Events needing backend/connector logic: ${c.connectorEvents.map((e) => `${e.trigger}/${e.action}`).join(', ')}`);
  }
  lines.push('');
  lines.push(plan.backendBoundary.rule);
  return lines.join('\n') + '\n';
}

// Human view for the secondary Rust target: the single app_actions.rs seam + the NuiBackend hooks to implement.
function rustHuman(plan) {
  const r = plan.rust;
  const lines = [];
  lines.push('NativeUI Rust backend plan (secondary target)');
  lines.push(`Project: ${plan.projectPath}`);
  lines.push(`Seam: ${r.seamFile}  (impl ${r.trait} for ${r.implType})`);
  lines.push(`Model: ${r.model}`);
  lines.push(`Controls: ${r.controls}`);
  lines.push('');
  if (r.hooks.length) {
    lines.push('Implement these NuiBackend hooks:');
    for (const h of r.hooks) {
      lines.push(`- ${h.hook}`);
      for (const t of h.targets) lines.push(`    ${t}`);
    }
  } else {
    lines.push('No backend hooks required — every authored action is framework-owned (nav/visibility/animate).');
  }
  lines.push('');
  for (const n of r.notes) lines.push(`note: ${n}`);
  lines.push(`See: ${r.contractDoc}`);
  return lines.join('\n') + '\n';
}

function targetsHuman(plan) {
  const webOnly = plan.targetPlans.length > 0
    && plan.targetPlans.every((target) => target.targetId.startsWith('web-'));
  const lines = [webOnly ? 'NativeUI Web backend plan' : 'NativeUI all-target logic plan', `Project: ${plan.projectPath}`];
  for (const target of plan.targetPlans) {
    lines.push('', `${target.targetId} (${target.releaseStatus})`, `  UI: ${target.generatedUi}`, `  Logic: ${target.logicType}`);
    lines.push(`  Write once: ${target.writeOnceFiles.join(', ')}`);
    if (target.seam?.appActionsFile) {
      lines.push(`  App actions: ${target.seam.appActionsFile} (${target.seam.asyncContract})`);
      lines.push(`  Data adapters: ${target.seam.dataAdaptersFile}`);
      lines.push(`  Custom components: ${target.seam.customComponentsFile}`);
    }
    lines.push(`  Derived: ${target.endpoints.length} endpoint(s), ${target.databases.length} database operation(s), ${target.repeaters.length} live list(s)`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  try {
    const { project: projectPath, format, out, platform, selectedTargets, explicitTargets } = parseArgs(process.argv.slice(2));
    let text;
    try {
      text = await fs.readFile(projectPath, 'utf8');
    } catch (e) {
      throw new ConnectorPlanError(e.code === 'ENOENT' ? `Project not found: ${projectPath}` : `Could not read ${projectPath}: ${e.message}`);
    }
    let project;
    try {
      project = JSON.parse(text);
    } catch {
      throw new ConnectorPlanError(`Project is not valid JSON: ${projectPath}`);
    }
    if (!project || typeof project !== 'object' || !Array.isArray(project.stages) || !project.stages.length) {
      throw new ConnectorPlanError(`Project has no stages[]: ${projectPath}`);
    }
    const legacy = platform === 'rust' ? resolveTargets(['rust'])
      : platform === 'web' ? resolveTargets(['web'])
      : platform === 'android' ? resolveTargets(['android'])
        : platform === 'ios' ? resolveTargets(['ios']) : resolveTargets(['mobile']);
    const plan = attachTargetPlans(buildPlan(project, projectPath), explicitTargets ? selectedTargets : legacy);
    const payload =
      format === 'human'
        ? explicitTargets
          ? targetsHuman(plan)
          : platform === 'rust'
          ? rustHuman(plan)
          : platform === 'web'
          ? targetsHuman(plan)
          : human(plan)
        : JSON.stringify(plan, null, 2);
    if (out) {
      const outPath = path.resolve(out);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, payload);
      process.stdout.write(`Wrote connector plan -> ${outPath}\n`);
    } else {
      process.stdout.write(payload);
    }
  } catch (err) {
    if (err instanceof ConnectorPlanError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export { attachTargetPlans, buildPlan, buildWebSeamPlan, parseArgs, targetsHuman };
