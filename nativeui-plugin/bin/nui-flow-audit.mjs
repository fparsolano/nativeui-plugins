#!/usr/bin/env node
// Fail-closed audit for dynamic NativeUI journeys, interactions, and UX states.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class FlowAuditError extends Error {}

const USAGE = 'Usage: node bin/nui-flow-audit.mjs <html|project.json...> [-o report.json]';
const ASYNC_ACTIONS = new Set(['CALL_API', 'CALL_DATABASE']);
const STATE_WORDS = ['loading', 'empty', 'error', 'success', 'validation', 'disabled', 'selected', 'retry', 'skeleton'];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function stateWords(text) {
  const lowered = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return STATE_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(lowered));
}

function formRanges(text) {
  const ranges = [];
  const pattern = /<form\b[\s\S]*?<\/form\s*>/gi;
  let match;
  while ((match = pattern.exec(text))) ranges.push([match.index, pattern.lastIndex]);
  return ranges;
}

export function analyzeHtmlFlowSource(text, input = '<html>') {
  const links = count(text, /<a\b[^>]*\bhref\s*=\s*["'][^"']+["']/gi);
  const internalLinks = count(text, /<a\b[^>]*\bhref\s*=\s*["']#[^"']+["']/gi);
  const forms = count(text, /<form\b/gi);
  const authoredEvents = count(text, /\son(?:click|dblclick|change|input|submit|reset|focus|blur|keydown|keyup|pointerdown|pointerup)\s*=/gi);
  const portableActions = count(text, /\sdata-nui-on-tap\s*=\s*["'](?:toggle|show|hide|select):#[A-Za-z_][\w-]*["']/gi);
  const repeaters = count(text, /\sdata-nui-list\s*=/gi);
  const listStates = unique([...text.matchAll(/\sdata-nui-list-state\s*=\s*["'](loading|empty|error)["']/gi)].map((match) => match[1].toLowerCase()));
  const ranges = formRanges(text);
  const deadButtons = [];
  const buttons = /<button\b([^>]*)>/gi;
  let button;
  while ((button = buttons.exec(text))) {
    const inForm = ranges.some(([start, end]) => button.index >= start && button.index < end);
    if (!inForm && !/\son(?:click|dblclick|pointerdown|pointerup)\s*=/i.test(button[1])
      && !/\sdata-nui-on-tap\s*=\s*["'](?:toggle|show|hide|select):#[A-Za-z_][\w-]*["']/i.test(button[1])) {
      deadButtons.push({ index: button.index, id: button[1].match(/\bid\s*=\s*["']([^"']+)/i)?.[1] || null });
    }
  }
  const states = stateWords(text);
  const issues = [];
  if (links + forms + authoredEvents + portableActions === 0) {
    issues.push({ code: 'flow.interactions-missing', message: 'Screen has no authored navigation, form, or event interaction; add a real user journey.' });
  }
  if (deadButtons.length) {
    issues.push({ code: 'flow.dead-controls', message: 'Buttons outside forms need an authored event so they are not dead controls.', detail: { buttons: deadButtons } });
  }
  if (forms > 0) {
    const missing = ['error', 'success'].filter((required) => !states.includes(required) && !(required === 'error' && states.includes('validation')));
    if (missing.length) issues.push({ code: 'flow.form-states-missing', message: 'Forms must design validation/error and success feedback states.', detail: { missing } });
  }
  if (repeaters > 0) {
    const missing = ['loading', 'empty', 'error'].filter((required) => !listStates.includes(required));
    if (missing.length) issues.push({ code: 'flow.list-states-missing', message: 'Dynamic lists must design loading, empty, and error panes.', detail: { missing } });
  }
  return {
    input: input === '<html>' ? input : path.resolve(input), kind: 'html-css', ok: issues.length === 0,
    links, internalLinks, forms, authoredEvents, portableActions, repeaters, listStates, states, deadButtons, issues,
  };
}

export async function analyzeHtmlFlow(file) {
  const text = await fs.readFile(file, 'utf8').catch((error) => {
    throw new FlowAuditError(error.code === 'ENOENT' ? `Input not found: ${file}` : `Could not read ${file}: ${error.message}`);
  });
  return analyzeHtmlFlowSource(text, file);
}

function walkNodes(nodes, fn, stageIndex) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    fn(node, stageIndex);
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child);
    if (node.graphicNode) visit(node.graphicNode);
    if (node.clipNode) visit(node.clipNode);
  };
  for (const node of Array.isArray(nodes) ? nodes : []) visit(node);
}

function interactionRows(owner, stageIndex, nodeId) {
  return [...(Array.isArray(owner?.interactionSpecs) ? owner.interactionSpecs : []),
    ...(Array.isArray(owner?.interactions) ? owner.interactions : [])]
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item, stageIndex, nodeId }));
}

function actionName(item) {
  const raw = item?.action ?? item?.actionId;
  if (typeof raw === 'string') return raw;
  if (typeof raw?.value === 'string') return raw.value;
  if (typeof raw?.id === 'string') return raw.id;
  if (typeof raw?.id?.value === 'string') return raw.id.value;
  return '';
}

export function analyzeProjectFlowValue(project, input = '<project>') {
  if (!Array.isArray(project?.stages) || !project.stages.length) throw new FlowAuditError(`JSON input is not a NativeUI project: ${input}`);
  const interactions = [];
  const states = new Set();
  let repeaterCount = 0;
  for (const [stageIndex, stage] of project.stages.entries()) {
    interactions.push(...interactionRows(stage, stageIndex, null));
    walkNodes(stage.rootNodes, (node) => {
      interactions.push(...interactionRows(node, stageIndex, node.id || null));
      if (node.repeater?.enabled === true) repeaterCount++;
      for (const key of Object.keys(node.stateOverrides || {})) states.add(String(key).toLowerCase());
      for (const word of stateWords([node.id, node.name, node.text, node.promptText, node.accessibilityText, node.styleClass].join(' '))) states.add(word);
    }, stageIndex);
  }
  const actions = interactions.map((item) => actionName(item).toUpperCase()).filter(Boolean);
  const issues = [];
  if (!actions.length) issues.push({ code: 'flow.interactions-missing', message: 'Project has no authored actions; every design needs a real dynamic user flow.' });
  if (project.stages.length > 1 && !actions.includes('NAVIGATE_TO_STAGE')) {
    issues.push({ code: 'flow.navigation-missing', message: 'Multi-stage projects must author navigation between stages.' });
  }
  const stateList = [...states];
  if (actions.some((action) => ASYNC_ACTIONS.has(action))) {
    const missing = ['loading', 'error'].filter((state) => !states.has(state));
    if (missing.length) issues.push({ code: 'flow.async-states-missing', message: 'API/database flows must design loading and error states.', detail: { missing } });
  }
  if (actions.includes('SUBMIT_FORM')) {
    const missing = ['success'].filter((state) => !states.has(state));
    if (!states.has('error') && !states.has('validation')) missing.push('error-or-validation');
    if (missing.length) issues.push({ code: 'flow.form-states-missing', message: 'Form submission must design validation/error and success feedback.', detail: { missing } });
  }
  if (repeaterCount > 0) {
    const missing = ['loading', 'empty', 'error'].filter((state) => !states.has(state));
    if (missing.length) issues.push({ code: 'flow.list-states-missing', message: 'Dynamic lists must design loading, empty, and error states.', detail: { missing } });
  }
  return {
    input: input === '<project>' ? input : path.resolve(input), kind: 'project-json', ok: issues.length === 0,
    stageCount: project.stages.length, interactionCount: interactions.length, actions: unique(actions),
    states: stateList.sort(), repeaterCount, issues,
  };
}

export async function analyzeProjectFlow(file) {
  let project;
  try {
    project = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new FlowAuditError(error.code === 'ENOENT' ? `Input not found: ${file}` : `Project is not valid JSON: ${file}`);
  }
  return analyzeProjectFlowValue(project, file);
}

export async function auditFlowInputs(inputs) {
  const items = [];
  for (const input of inputs) {
    const ext = path.extname(input).toLowerCase();
    items.push(ext === '.json' ? await analyzeProjectFlow(input) : await analyzeHtmlFlow(input));
  }
  const htmlItems = items.filter((item) => item.kind === 'html-css');
  const aggregateIssues = [];
  if (htmlItems.length > 1 && !htmlItems.some((item) => item.internalLinks > 0)) {
    aggregateIssues.push({ code: 'flow.navigation-missing', message: 'Multi-screen HTML must link its authored journey with internal stage navigation.' });
  }
  return {
    version: 1,
    tool: 'nui-flow-audit',
    ok: items.every((item) => item.ok) && aggregateIssues.length === 0,
    inputs: items,
    issues: aggregateIssues,
  };
}

function parseArgs(argv) {
  const inputs = [];
  let out = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') out = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') throw new FlowAuditError(USAGE);
    else if (arg.startsWith('-')) throw new FlowAuditError(`Unknown flag: ${arg}\n${USAGE}`);
    else inputs.push(arg);
  }
  if (!inputs.length) throw new FlowAuditError(`No inputs given.\n${USAGE}`);
  return { inputs, out };
}

async function main() {
  try {
    const { inputs, out } = parseArgs(process.argv.slice(2));
    const report = await auditFlowInputs(inputs);
    const payload = JSON.stringify(report, null, 2) + '\n';
    if (out) {
      const target = path.resolve(out);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, payload);
      process.stdout.write(`Wrote flow audit -> ${target}\n`);
    } else process.stdout.write(payload);
    if (!report.ok) {
      process.stderr.write('Dynamic flow audit failed: resolve missing interactions, navigation, dead controls, or UX states.\n');
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
