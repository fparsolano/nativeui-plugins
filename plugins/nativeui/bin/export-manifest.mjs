import fs from 'node:fs';
import path from 'node:path';

export const EXPORT_MANIFEST_FILE = 'nativeui-export-manifest.json';

export class ExportManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportManifestError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeManifestPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExportManifestError('Export manifests may only declare non-empty relative file paths.');
  }
  const raw = value.replaceAll('\\', '/');
  if (raw.includes('\0') || path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    throw new ExportManifestError(`Export manifest path must be relative: ${value}`);
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new ExportManifestError(`Export manifest path escapes its project root: ${value}`);
  }
  return normalized;
}

function stringArray(value, field, errors, { paths = false, nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  if (nonEmpty && value.length === 0) errors.push(`${field} must not be empty.`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      errors.push(`${field} contains a non-string or empty value.`);
      continue;
    }
    try {
      out.push(paths ? normalizeManifestPath(item) : item.trim());
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (new Set(out).size !== out.length) errors.push(`${field} contains duplicate values.`);
  return out;
}

const WEB_RENDER_MODES = Object.freeze({
  'web-html': ['static'],
  'web-react': ['static', 'ssr'],
  'web-vue': ['static', 'ssr'],
  'web-angular': ['static', 'ssr'],
  'web-astro': ['static', 'ssr'],
});

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validateCommandMap(value, field, errors, requiredCommands) {
  if (!isObject(value)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  for (const [command, invocation] of Object.entries(value)) {
    if (typeof invocation !== 'string' || !invocation.trim()) {
      errors.push(`${field}.${command} must be a non-empty string.`);
    }
  }
  for (const command of requiredCommands) {
    if (typeof value[command] !== 'string' || !value[command].trim()) {
      errors.push(`${field}.${command} must be a non-empty string.`);
    }
  }
}

export function declaredTargetIds(manifest) {
  return Array.isArray(manifest?.targetIds)
    ? manifest.targetIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
    : [];
}

export function manifestFileOwnership(manifest) {
  const errors = [];
  const generatedFiles = stringArray(manifest?.generatedFiles, 'generatedFiles', errors, { paths: true });
  const writeOnceFiles = stringArray(manifest?.writeOnceFiles, 'writeOnceFiles', errors, { paths: true });
  const writeOnce = new Set(writeOnceFiles);
  const overlap = generatedFiles.filter((file) => writeOnce.has(file));
  if (overlap.length) errors.push(`generatedFiles and writeOnceFiles overlap: ${overlap.join(', ')}`);
  return { generatedFiles, writeOnceFiles, errors };
}

function validateModeMetadata(metadata, field, errors, ownership) {
  if (!isObject(metadata)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  for (const key of ['build', 'run', 'release']) {
    if (typeof metadata[key] !== 'string' || !metadata[key].trim()) {
      errors.push(`${field}.${key} must be a non-empty string.`);
    }
  }
  stringArray(metadata.releaseOutputs, `${field}.releaseOutputs`, errors, { paths: true, nonEmpty: true });
  stringArray(metadata.toolchain, `${field}.toolchain`, errors, { nonEmpty: true });
  const generatedFiles = stringArray(metadata.generatedFiles, `${field}.generatedFiles`, errors, { paths: true });
  const writeOnceFiles = stringArray(metadata.writeOnceFiles, `${field}.writeOnceFiles`, errors, { paths: true });
  if (!sameStrings(generatedFiles, ownership.generatedFiles)) {
    errors.push(`${field}.generatedFiles must match generatedFiles.`);
  }
  if (!sameStrings(writeOnceFiles, ownership.writeOnceFiles)) {
    errors.push(`${field}.writeOnceFiles must match writeOnceFiles.`);
  }
}

function validateWebCapabilityProjection(manifest, targetId, errors) {
  const contract = manifest.capabilityContract;
  if (!isObject(contract)) {
    errors.push('capabilityContract must be an object for authored web exports.');
  } else {
    for (const field of ['schemaVersion', 'capabilityCount', 'kindCount', 'triggerCount', 'actionCount', 'timelinePropertyCount']) {
      if (!Number.isInteger(contract[field]) || contract[field] <= 0) {
        errors.push(`capabilityContract.${field} must be a positive integer.`);
      }
    }
    for (const field of ['manifestVersion', 'enforcementPhase']) {
      if (typeof contract[field] !== 'string' || !contract[field].trim()) {
        errors.push(`capabilityContract.${field} must be a non-empty string.`);
      }
    }
  }

  const report = manifest.capabilityReport?.[targetId];
  if (!isObject(report)) {
    errors.push(`capabilityReport.${targetId} must be an object.`);
    return;
  }
  if (report.sourceReport !== 'web-export-report.txt') {
    errors.push(`capabilityReport.${targetId}.sourceReport must be web-export-report.txt.`);
  }
  if (report.status !== 'pass') errors.push(`capabilityReport.${targetId}.status must be pass.`);
  const declarations = [];
  for (const group of ['capabilities', 'kindContracts', 'triggerContracts', 'actionContracts', 'timelinePropertyContracts']) {
    if (!Array.isArray(report[group])) errors.push(`capabilityReport.${targetId}.${group} must be an array.`);
    else declarations.push(...report[group]);
  }
  const receipts = Array.isArray(report.occurrenceReceipts) ? report.occurrenceReceipts : [];
  if (!Array.isArray(report.occurrenceReceipts) || receipts.length === 0) {
    errors.push(`capabilityReport.${targetId}.occurrenceReceipts must be a non-empty array.`);
  }
  let occurrenceCount = 0;
  for (const [index, receipt] of receipts.entries()) {
    const field = `capabilityReport.${targetId}.occurrenceReceipts[${index}]`;
    if (!isObject(receipt)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    for (const key of ['id', 'receiptCategory', 'disposition', 'implementation', 'loweringId']) {
      if (typeof receipt[key] !== 'string' || !receipt[key].trim()) errors.push(`${field}.${key} must be non-empty.`);
    }
    if (receipt.implementation !== receipt.loweringId) {
      errors.push(`${field}.implementation must equal loweringId.`);
    }
    if (!Number.isInteger(receipt.count) || receipt.count <= 0) {
      errors.push(`${field}.count must be a positive integer.`);
      continue;
    }
    occurrenceCount += receipt.count;
    const evidence = stringArray(receipt.evidence, `${field}.evidence`, errors, { nonEmpty: true });
    if (evidence.length !== receipt.count) errors.push(`${field}.evidence must contain exactly count entries.`);
  }
  if (report.receiptCategoryCount !== receipts.length) {
    errors.push(`capabilityReport.${targetId}.receiptCategoryCount must match occurrenceReceipts.`);
  }
  if (JSON.stringify(declarations) !== JSON.stringify(receipts)) {
    errors.push(`capabilityReport.${targetId} declaration groups must exactly project occurrenceReceipts.`);
  }
  if (report.occurrenceCount !== occurrenceCount) {
    errors.push(`capabilityReport.${targetId}.occurrenceCount must equal the receipt occurrence sum.`);
  }
  if (!Array.isArray(report.compilerSummaries)) {
    errors.push(`capabilityReport.${targetId}.compilerSummaries must be an array.`);
  }
}

export function validateExportManifest(manifest, {
  root = '',
  targetId = '',
  renderMode = '',
  requireDeclaredFiles = false,
} = {}) {
  const errors = [];
  if (!isObject(manifest)) return { valid: false, errors: ['Manifest root must be an object.'] };
  if (manifest.schemaVersion !== 2) errors.push(`schemaVersion must be 2 (got ${JSON.stringify(manifest.schemaVersion)}).`);
  const targetIds = stringArray(manifest.targetIds, 'targetIds', errors, { nonEmpty: true });
  const ownership = manifestFileOwnership(manifest);
  errors.push(...ownership.errors);
  if (!ownership.generatedFiles.includes(EXPORT_MANIFEST_FILE)) {
    errors.push(`generatedFiles must declare ${EXPORT_MANIFEST_FILE}.`);
  }
  if (targetId && !targetIds.includes(targetId)) {
    errors.push(`manifest declares [${targetIds.join(', ')}], not ${targetId}.`);
  }

  const webTargetIds = targetIds.filter((id) => id.startsWith('web-'));
  if (webTargetIds.length) {
    if (webTargetIds.length > 1) errors.push('A single authored web manifest may declare only one web target.');
    if (!isObject(manifest.renderModes)) errors.push('renderModes must be an object for web exports.');
    if (!isObject(manifest.targets)) errors.push('targets must be an object for web exports.');
    if (!isObject(manifest.commands)) errors.push('commands must be an object for web exports.');
    if (!isObject(manifest.toolchains)) errors.push('toolchains must be an object for web exports.');
    for (const id of webTargetIds) {
      validateWebCapabilityProjection(manifest, id, errors);
      const topModes = stringArray(manifest.renderModes?.[id], `renderModes.${id}`, errors, { nonEmpty: true });
      const expectedModes = WEB_RENDER_MODES[id];
      if (!expectedModes) {
        errors.push(`Unknown authored web target: ${id}.`);
      } else if (!sameStrings(topModes, expectedModes)) {
        errors.push(`${id} renderModes must be ${JSON.stringify(expectedModes)}.`);
      }
      const requiredCommands = id === 'web-html'
        ? ['run', 'release']
        : ['build', 'run', 'test', 'release', 'ssr'];
      validateCommandMap(manifest.commands?.[id], `commands.${id}`, errors, requiredCommands);
      stringArray(manifest.toolchains?.[id], `toolchains.${id}`, errors, { nonEmpty: true });
      const target = manifest.targets?.[id];
      if (!isObject(target)) {
        errors.push(`targets.${id} must be an object.`);
        continue;
      }
      const targetModes = stringArray(target.renderModes, `targets.${id}.renderModes`, errors, { nonEmpty: true });
      if (!sameStrings(topModes, targetModes)) {
        errors.push(`renderModes.${id} must match targets.${id}.renderModes.`);
      }
      if (!isObject(target.modes)) {
        errors.push(`targets.${id}.modes must be an object.`);
      } else {
        const declaredModeKeys = Object.keys(target.modes);
        if (!sameStringSet(declaredModeKeys, topModes)) {
          errors.push(`targets.${id}.modes keys must exactly match renderModes.${id}.`);
        }
        for (const mode of topModes) {
          validateModeMetadata(target.modes[mode], `targets.${id}.modes.${mode}`, errors, ownership);
        }
      }
      const targetGenerated = stringArray(target.generatedFiles, `targets.${id}.generatedFiles`, errors, { paths: true });
      const targetWriteOnce = stringArray(target.writeOnceFiles, `targets.${id}.writeOnceFiles`, errors, { paths: true });
      if (!sameStrings(targetGenerated, ownership.generatedFiles)) {
        errors.push(`targets.${id}.generatedFiles must match generatedFiles.`);
      }
      if (!sameStrings(targetWriteOnce, ownership.writeOnceFiles)) {
        errors.push(`targets.${id}.writeOnceFiles must match writeOnceFiles.`);
      }
    }
  }

  if (renderMode && !targetId) {
    errors.push('A targetId is required when validating a renderMode.');
  } else if (targetId && renderMode) {
    const modes = manifest.renderModes?.[targetId];
    if (!Array.isArray(modes) || !modes.includes(renderMode)) {
      errors.push(`${targetId} does not declare render mode ${renderMode}.`);
    }
    if (!isObject(manifest.targets?.[targetId]?.modes?.[renderMode])) {
      errors.push(`targets.${targetId}.modes.${renderMode} metadata is missing.`);
    }
  }

  if (requireDeclaredFiles) {
    if (!root) errors.push('A project root is required to validate declared files.');
    else {
      for (const relative of [...ownership.generatedFiles, ...ownership.writeOnceFiles]) {
        const absolute = path.resolve(root, ...relative.split('/'));
        if (!absolute.startsWith(path.resolve(root) + path.sep) && absolute !== path.resolve(root)) {
          errors.push(`Declared path escapes the project root: ${relative}`);
        } else if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
          errors.push(`Declared file is missing: ${relative}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    targetIds,
    generatedFiles: ownership.generatedFiles,
    writeOnceFiles: ownership.writeOnceFiles,
  };
}

export function readExportManifest(root, options = {}) {
  const projectRoot = path.resolve(root);
  const manifestPath = path.join(projectRoot, EXPORT_MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new ExportManifestError(`Could not read ${manifestPath}: ${error.message}`);
  }
  const validation = validateExportManifest(manifest, { root: projectRoot, ...options });
  if (!validation.valid) {
    throw new ExportManifestError(`${manifestPath} is invalid:\n  - ${validation.errors.join('\n  - ')}`);
  }
  return { root: projectRoot, path: manifestPath, manifest, ...validation };
}

export function discoverExportManifests(root, { maxDepth = 6 } = {}) {
  const start = path.resolve(root);
  if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) {
    throw new ExportManifestError(`Export root is not a directory: ${start}`);
  }
  const records = [];
  const queue = [{ root: start, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    const manifestPath = path.join(current.root, EXPORT_MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      records.push(readExportManifest(current.root));
      continue;
    }
    if (current.depth >= maxDepth) continue;
    for (const entry of fs.readdirSync(current.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', '.git', '.gradle', '.idea'].includes(entry.name)) continue;
      queue.push({ root: path.join(current.root, entry.name), depth: current.depth + 1 });
    }
  }
  return records.sort((a, b) => a.root.localeCompare(b.root));
}

export function resolveManifestTargetRoots(root, targetIds, { required = true } = {}) {
  const start = path.resolve(root);
  const records = discoverExportManifests(start);
  if (!records.length) {
    if (required) throw new ExportManifestError(`No schema-2 ${EXPORT_MANIFEST_FILE} was found under ${start}.`);
    return { records, roots: new Map() };
  }
  const roots = new Map();
  for (const record of records) {
    for (const id of record.targetIds) {
      if (roots.has(id) && roots.get(id) !== record.root) {
        throw new ExportManifestError(`Multiple export roots declare ${id}: ${roots.get(id)} and ${record.root}.`);
      }
      roots.set(id, record.root);
    }
  }
  const missing = targetIds.filter((id) => !roots.has(id));
  if (missing.length && required) {
    const discovered = [...roots.keys()].sort();
    throw new ExportManifestError(
      `Export root ${start} does not contain the requested lane(s) ${missing.join(', ')}; manifest lanes are ${discovered.join(', ') || '(none)'}.`,
    );
  }
  return { records, roots };
}

function angularOutputBase(root) {
  const configPath = path.join(root, 'angular.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const projectName = config.defaultProject && config.projects?.[config.defaultProject]
      ? config.defaultProject
      : Object.keys(config.projects || {})[0];
    const outputPath = projectName && config.projects?.[projectName]?.architect?.build?.options?.outputPath;
    if (typeof outputPath === 'string' && outputPath.trim()) return normalizeManifestPath(outputPath);
    if (isObject(outputPath) && typeof outputPath.base === 'string') return normalizeManifestPath(outputPath.base);
  } catch {
    return null;
  }
  return null;
}

export function webArtifactLayout(root, targetId, renderMode = 'static') {
  if (!['web-html', 'web-react', 'web-vue', 'web-angular', 'web-astro'].includes(targetId)) {
    throw new ExportManifestError(`Unknown authored web lane: ${targetId}`);
  }
  if (!['static', 'ssr'].includes(renderMode)) throw new ExportManifestError(`Unknown web render mode: ${renderMode}`);
  if (targetId === 'web-html' && renderMode !== 'static') {
    throw new ExportManifestError('web-html supports only the static render mode.');
  }

  let clientDir;
  let serverEntry = '';
  if (targetId === 'web-html') clientDir = '';
  else if (targetId === 'web-react') {
    clientDir = 'build/client';
    serverEntry = 'build/server/index.js';
  } else if (targetId === 'web-vue') {
    clientDir = '.output/public';
    serverEntry = '.output/server/index.mjs';
  } else if (targetId === 'web-angular') {
    const base = angularOutputBase(root);
    clientDir = base ? `${base}/browser` : 'dist/<angular-project>/browser';
    serverEntry = base ? `${base}/server/server.mjs` : 'dist/<angular-project>/server/server.mjs';
  } else {
    clientDir = renderMode === 'ssr' ? 'dist/client' : 'dist';
    serverEntry = 'dist/server/entry.mjs';
  }
  const serviceWorker = targetId === 'web-angular' ? 'ngsw-worker.js' : 'sw.js';
  const clientFile = (file) => clientDir ? `${clientDir}/${file}` : file;
  const requiredFiles = renderMode === 'static'
    ? [
        clientFile('index.html'),
        clientFile('manifest.webmanifest'),
        clientFile(serviceWorker),
      ]
    : [
        serverEntry,
        clientFile('manifest.webmanifest'),
        clientFile(serviceWorker),
      ];
  return {
    targetId,
    renderMode,
    clientDir: clientDir ? normalizeManifestPath(clientDir) : '.',
    serverEntry: serverEntry ? normalizeManifestPath(serverEntry) : '',
    requiredFiles: requiredFiles.map(normalizeManifestPath),
    resolvable: !requiredFiles.some((file) => file.includes('<angular-project>')),
  };
}

export function validateWebArtifacts(root, targetId, renderMode = 'static') {
  const projectRoot = path.resolve(root);
  const layout = webArtifactLayout(projectRoot, targetId, renderMode);
  if (!layout.resolvable) {
    return { valid: false, artifacts: [], missing: layout.requiredFiles, ...layout };
  }
  const artifacts = [];
  const missing = [];
  for (const relative of layout.requiredFiles) {
    const absolute = path.resolve(projectRoot, ...relative.split('/'));
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) artifacts.push(absolute);
    else missing.push(relative);
  }
  return {
    ...layout,
    valid: missing.length === 0,
    artifacts,
    missing,
    staticOutputDir: renderMode === 'static'
      ? (layout.clientDir === '.' ? projectRoot : path.resolve(projectRoot, ...layout.clientDir.split('/')))
      : '',
    clientOutputDir: layout.clientDir === '.' ? projectRoot : path.resolve(projectRoot, ...layout.clientDir.split('/')),
  };
}
