// nui-export.mjs — export a NativeUI project to one or more product targets.
//
// POSTs the project JSON to <exportServiceUrl>/export/<platform> (or
// /export/<platform>/manifest with --manifest), streams the returned ZIP to
// <outdir>/<platform>-export.zip, and unzips it if `unzip` is available.
//
// All registered target IDs have an export and manifest disposition. Shared
// Rust and C# projects are requested once when more than one of their host lanes
// is selected. Legacy --platform aliases remain compatible.
//
// By default the service emits the CLEAN, runnable PROD app. Pass --beta (or
// --mode beta) only for the internal capture harness.
//
// Usage:
//   node bin/nui-export.mjs <project.json> --target <target-id>... -o <outdir>
//   node bin/nui-export.mjs <project.json> --all-targets -o <outdir>
//   node bin/nui-export.mjs <project.json> --platform android|ios|rust|csharp|web -o <outdir>

import { promises as fs } from 'node:fs';
import { createWriteStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';
import { exportRequests, resolveTargets } from './target-contract.mjs';
import {
  EXPORT_MANIFEST_FILE,
  ExportManifestError,
  normalizeManifestPath,
  readExportManifest,
} from './export-manifest.mjs';

class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportError';
  }
}

const USAGE =
  'Usage: node bin/nui-export.mjs <project.json> (--target <id>... | --all-targets | --platform android|ios|rust|csharp|web) -o <outdir> [--manifest] [--force] [--beta | --prod | --mode beta|prod]';

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new ExportError(`Missing value for ${flag}.\n${USAGE}`);
  }
  return value;
}

function parsePositiveInt(raw, flag) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ExportError(`${flag} must be a positive integer (got '${raw}').`);
  }
  return n;
}

function parseArgs(argv) {
  let project;
  let platform;
  const targetTokens = [];
  let allTargets = false;
  let outdir;
  let manifest = false;
  let force = false;
  let mode = 'prod';
  const nativeOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' || a === '-p') {
      platform = requireValue(argv, i, a);
      i++;
    } else if (a === '--target') {
      targetTokens.push(requireValue(argv, i, a));
      i++;
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === '-o' || a === '--output') {
      outdir = requireValue(argv, i, a);
      i++;
    } else if (a === '--manifest') {
      manifest = true;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--beta') {
      mode = 'beta';
    } else if (a === '--prod') {
      mode = 'prod';
    } else if (a === '--mode') {
      mode = requireValue(argv, i, a);
      i++;
    } else if (a === '--app-name') {
      nativeOptions.appName = requireValue(argv, i, a);
      i++;
    } else if (a === '--android-package') {
      nativeOptions.androidPackage = requireValue(argv, i, a);
      i++;
    } else if (a === '--ios-bundle-id') {
      nativeOptions.iosBundleId = requireValue(argv, i, a);
      i++;
    } else if (a === '--ios-layout') {
      nativeOptions.iosLayoutMode = requireValue(argv, i, a);
      i++;
    } else if (a === '--android-layout') {
      nativeOptions.androidLayoutMode = requireValue(argv, i, a);
      i++;
    } else if (a === '--ios-controls') {
      nativeOptions.iosControlMode = requireValue(argv, i, a);
      i++;
    } else if (a === '--version-name') {
      nativeOptions.versionName = requireValue(argv, i, a);
      i++;
    } else if (a === '--version-code') {
      nativeOptions.versionCode = parsePositiveInt(requireValue(argv, i, a), a);
      i++;
    } else if (a === '--ios-build-number') {
      nativeOptions.iosBuildNumber = requireValue(argv, i, a);
      i++;
    } else if (a === '--android-min-sdk') {
      nativeOptions.androidMinSdk = parsePositiveInt(requireValue(argv, i, a), a);
      i++;
    } else if (a === '--android-target-sdk') {
      nativeOptions.androidTargetSdk = parsePositiveInt(requireValue(argv, i, a), a);
      i++;
    } else if (a === '--android-compile-sdk') {
      nativeOptions.androidCompileSdk = parsePositiveInt(requireValue(argv, i, a), a);
      i++;
    } else if (a === '--ios-deployment-target') {
      nativeOptions.iosDeploymentTarget = requireValue(argv, i, a);
      i++;
    } else if (a === '--development-team') {
      nativeOptions.developmentTeam = requireValue(argv, i, a);
      i++;
    } else if (a === '--allow-debug-cleartext-http') {
      nativeOptions.allowDebugCleartextHttp = true;
    } else if (a === '-h' || a === '--help') {
      throw new ExportError(USAGE);
    } else if (a.startsWith('-')) {
      throw new ExportError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!project) {
      project = a;
    } else {
      throw new ExportError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!project) throw new ExportError(`Missing <project.json>.\n${USAGE}`);
  if (!platform && !targetTokens.length && !allTargets) throw new ExportError(`Provide --target, --all-targets, or --platform.\n${USAGE}`);
  if (platform && (targetTokens.length || allTargets)) throw new ExportError('Use --platform or --target/--all-targets, not both.');
  if (platform) targetTokens.push(platform.toLowerCase());
  let targets;
  try {
    targets = resolveTargets(targetTokens, { allTargets });
  } catch (error) {
    throw new ExportError(error.message);
  }
  if (!outdir) throw new ExportError(`Missing -o <outdir>.\n${USAGE}`);
  mode = String(mode || 'prod').toLowerCase();
  if (mode !== 'beta' && mode !== 'prod') {
    throw new ExportError(`--mode must be 'beta' or 'prod' (got '${mode}').`);
  }
  if (
    nativeOptions.iosLayoutMode &&
    !['nativeui-reflow', 'swiftui-native'].includes(String(nativeOptions.iosLayoutMode).toLowerCase())
  ) {
    throw new ExportError(
      `--ios-layout must be 'nativeui-reflow' or 'swiftui-native' (got '${nativeOptions.iosLayoutMode}').`
    );
  }
  if (
    nativeOptions.androidLayoutMode &&
    !['nativeui-views', 'compose-native'].includes(String(nativeOptions.androidLayoutMode).toLowerCase())
  ) {
    throw new ExportError(
      `--android-layout must be 'compose-native' (default) or 'nativeui-views' (secondary legacy XML lane, got '${nativeOptions.androidLayoutMode}').`
    );
  }

  if (
    nativeOptions.iosControlMode &&
    !['uikit-compatible', 'swiftui-native', 'auto'].includes(
      String(nativeOptions.iosControlMode).toLowerCase()
    )
  ) {
    throw new ExportError(
      `--ios-controls must be 'uikit-compatible', 'swiftui-native', or 'auto' (got '${nativeOptions.iosControlMode}').`
    );
  }
  nativeOptions.mode = mode;
  return { project, targets, outdir, manifest, mode, nativeOptions, force };
}

function hasTool(cmd, probeArgs) {
  const probe = spawnSync(cmd, probeArgs, { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

// Extract a ZIP using whatever's available, in preference order. Returns the
// tool name on success, or null if no extractor worked (caller leaves the .zip).
function tryUnzip(zipPath, destDir) {
  // 1. System `unzip` — the common case.
  if (hasTool('unzip', ['-v'])) {
    const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
    if (!r.error && r.status === 0) return 'unzip';
  }
  // 2. Python's zipfile module — present on most macOS/Linux without `unzip`.
  for (const py of ['python3', 'python']) {
    if (hasTool(py, ['--version'])) {
      const r = spawnSync(py, ['-m', 'zipfile', '-e', zipPath, destDir], { stdio: 'inherit' });
      if (!r.error && r.status === 0) return py;
    }
  }
  // 3. libarchive `tar` (macOS bsdtar / Linux with libarchive) reads ZIPs.
  if (hasTool('tar', ['--version'])) {
    const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
    if (!r.error && r.status === 0) return 'tar';
  }
  return null;
}

// The developer-owned "write-once" seam files: generated with wiring stubs on FIRST export, then
// edited by the developer. A plain overwrite on re-export destroys their work — the exact opposite
// of the round-trip promise. Matched by basename so lane/package path differences don't matter.
export const WRITE_ONCE_BASENAMES = new Set([
  'AppActions.swift',
  'NuiBackend.swift',
  'NuiBackend.kt',
  'NuiAppActionsImpl.kt',
  'app_actions.rs',
  'AppActions.cs',
  'app-actions.js',
  'app-actions.ts',
  'data-adapters.js',
  'data-adapters.ts',
  'custom-components.js',
  'custom-components.ts',
  '.gitignore',
]);

async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(p)));
    else if (e.isSymbolicLink()) throw new ExportError(`Refusing symbolic link in export archive: ${p}`);
    else out.push(p);
  }
  return out;
}

function optionsForRequest(base, request) {
  const options = { ...base };
  const id = request.targets[0]?.id || '';
  if (id === 'ios-swiftui') {
    options.iosLayoutMode = 'swiftui-native';
    options.iosControlMode = 'swiftui-native';
  } else if (id === 'ios-uikit') {
    options.iosLayoutMode = 'nativeui-reflow';
    options.iosControlMode = 'uikit-compatible';
  } else if (id === 'android-compose') {
    options.androidLayoutMode = 'compose-native';
  } else if (id === 'android-views') {
    options.androidLayoutMode = 'nativeui-views';
  } else if (id.startsWith('web-')) {
    options.webLayoutMode = request.targets[0].layoutMode;
  }
  return options;
}

function requestOutputDir(root, request, requestCount) {
  return requestCount === 1 ? path.resolve(root) : path.join(path.resolve(root), request.key);
}

async function performExport({ config, projectJson, request, outdir, manifest, mode, nativeOptions, force, requestCount }) {
  const body = JSON.stringify({
    ...projectJson,
    nativeExportOptions: {
      ...(projectJson.nativeExportOptions || {}),
      ...optionsForRequest(nativeOptions, request),
    },
  });
  const modeQuery = `?mode=${encodeURIComponent(mode)}`;
  const endpoint = manifest
    ? `${config.exportServiceUrl}/export/${request.platform}/manifest${modeQuery}`
    : `${config.exportServiceUrl}/export/${request.platform}${modeQuery}`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: await exportServiceHeaders(config, {
        'Content-Type': 'application/json',
        Accept: manifest ? 'application/json' : 'application/zip',
      }),
      body,
    });
  } catch (error) {
    throw new ExportError(`Network error contacting export service for ${request.key}: ${error.message}`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const map = {
      400: 'Bad request: the project JSON was rejected by the exporter.',
      401: exportServiceRejectedAuthMessage(config, 'Export'),
      403: exportServiceRejectedAuthMessage(config, 'Export'),
      413: 'Project too large for the export service (HTTP 413). Reduce assets/pages and retry.',
    };
    const head = map[res.status] || `Export failed (HTTP ${res.status}).`;
    throw new ExportError(`${request.key}: ${head}${errText ? `\n  ${errText.slice(0, 400)}` : ''}`);
  }

  const destination = requestOutputDir(outdir, request, requestCount);
  await fs.mkdir(destination, { recursive: true });
  // Keep the historical per-platform manifest filename for callers that already
  // consume it; the archive itself carries nativeui-export-manifest.json.
  const outName = manifest ? `${request.platform}-export-manifest.json` : `${request.platform}-export.zip`;
  const outPath = path.join(destination, outName);
  if (!res.body) await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  else await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath));
  const { size } = await fs.stat(outPath);
  if (size === 0) throw new ExportError(`${request.key} export returned an empty response.`);

  if (manifest) {
    process.stdout.write(`Wrote ${request.key} manifest -> ${outPath} (${size} bytes)\n`);
    return;
  }
  const { tool: unzippedWith, preserved, contractUpdates, pruned } = await extractProtected(outPath, destination, force);
  process.stdout.write(`Exported ${request.key} (${mode}) -> ${outPath} (${size} bytes)\n`);
  if (unzippedWith) {
    process.stdout.write(`  Unzipped into ${destination} (via ${unzippedWith})\n`);
    if (preserved.length) process.stdout.write(`  Preserved ${preserved.length} developer file(s): ${preserved.join(', ')}\n`);
    if (pruned.length) process.stdout.write(`  Pruned ${pruned.length} obsolete generated file(s): ${pruned.join(', ')}\n`);
    for (const rel of contractUpdates) {
      process.stdout.write(`  NOTE: the generated contract for ${rel} changed -- fresh version written to ${rel}.new\n`);
    }
  } else {
    process.stdout.write('  (no extractor found — install unzip, python3, or tar; left the .zip in place)\n');
  }
}

function ownershipAt(root, requireDeclaredFiles = false) {
  const manifestPath = path.join(root, EXPORT_MANIFEST_FILE);
  try {
    return existsSync(manifestPath) ? readExportManifest(root, { requireDeclaredFiles }) : null;
  } catch (error) {
    if (error instanceof ExportManifestError) throw new ExportError(error.message);
    throw error;
  }
}

function contractHash(contents) {
  const match = contents.toString('utf8').match(/^\s*(?:\/\/\s*)?@nativeui-contract\s+([a-f\d]{64})\s*$/im);
  return match ? match[1].toLowerCase() : '';
}

async function safeOwnedPath(root, relative, { allowFinalSymlink = false } = {}) {
  const normalized = normalizeManifestPath(relative);
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, ...normalized.split('/'));
  if (!absolute.startsWith(absoluteRoot + path.sep)) {
    throw new ExportError(`Refusing export path outside ${absoluteRoot}: ${relative}`);
  }
  let cursor = absoluteRoot;
  for (const part of normalized.split('/').slice(0, -1)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw new ExportError(`Refusing to write through symbolic link ${cursor}.`);
      if (!stat.isDirectory()) throw new ExportError(`Export parent is not a directory: ${cursor}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  if (!allowFinalSymlink) {
    try {
      if ((await fs.lstat(absolute)).isSymbolicLink()) {
        throw new ExportError(`Refusing to overwrite symbolic link ${absolute}.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { normalized, absolute };
}

async function removeEmptyParents(file, root) {
  const absoluteRoot = path.resolve(root);
  let current = path.dirname(file);
  while (current.startsWith(absoluteRoot + path.sep)) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

// Extract into a temp staging dir, then apply the archive's schema-2 ownership manifest. Files
// declared generated by the prior manifest are eligible for exact-path pruning when absent from
// the fresh manifest; declared write-once files are always preserved unless --force is explicit.
// A `.new` candidate is written only when both seam files carry different @nativeui-contract
// hashes. Content-only developer edits do not create noisy candidates, and .gitignore never does.
export async function extractProtected(zipPath, destDir, force) {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'nui-export-'));
  try {
    const tool = tryUnzip(zipPath, staging);
    if (!tool) return { tool: null, preserved: [], contractUpdates: [], pruned: [] };
    const previous = ownershipAt(destDir);
    const fresh = ownershipAt(staging, true);
    if (previous && !fresh) {
      throw new ExportError(
        `Refusing to refresh a manifest-owned export with an archive missing ${EXPORT_MANIFEST_FILE}.`,
      );
    }
    const stagedFiles = await listFilesRecursive(staging);
    stagedFiles.sort((a, b) => a.localeCompare(b));
    const stagedRelative = new Map(stagedFiles.map((file) => [
      path.relative(staging, file).split(path.sep).join('/'),
      file,
    ]));
    const freshOwned = new Set([...(fresh?.generatedFiles || []), ...(fresh?.writeOnceFiles || [])]);
    for (const relative of stagedRelative.keys()) {
      if (path.posix.basename(relative) === '.gitignore.new') {
        throw new ExportError('Refusing .gitignore.new from an export archive; .gitignore is always preserved in place.');
      }
      if (fresh && !freshOwned.has(relative)) {
        throw new ExportError(`Fresh export contains an undeclared file: ${relative}`);
      }
    }
    const previousGenerated = new Set(previous?.generatedFiles || []);
    const previousWriteOnce = new Set(previous?.writeOnceFiles || []);
    const freshGenerated = new Set(fresh?.generatedFiles || []);
    const freshWriteOnce = new Set(fresh?.writeOnceFiles || []);
    const pruned = [];

    for (const relative of [...previousGenerated].sort()) {
      if (freshGenerated.has(relative) || previousWriteOnce.has(relative) || freshWriteOnce.has(relative)) continue;
      const { normalized, absolute } = await safeOwnedPath(destDir, relative, { allowFinalSymlink: true });
      try {
        const stat = await fs.lstat(absolute);
        if (!stat.isFile() && !stat.isSymbolicLink()) {
          throw new ExportError(`Refusing to prune non-file generated path ${absolute}.`);
        }
        await fs.unlink(absolute);
        await removeEmptyParents(absolute, destDir);
        pruned.push(normalized);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    const preserved = [];
    const contractUpdates = [];
    for (const src of stagedFiles) {
      const rel = path.relative(staging, src).split(path.sep).join('/');
      const { normalized, absolute: dest } = await safeOwnedPath(destDir, rel);
      const protectedFile = previousWriteOnce.has(normalized)
        || freshWriteOnce.has(normalized)
        || (!previous && !fresh && WRITE_ONCE_BASENAMES.has(path.posix.basename(normalized)));
      let destExists = true;
      try { await fs.access(dest); } catch { destExists = false; }
      if (!force && protectedFile && destExists) {
        const [a, b] = await Promise.all([fs.readFile(src), fs.readFile(dest)]);
        const incomingHash = contractHash(a);
        const existingHash = contractHash(b);
        if (path.posix.basename(normalized) !== '.gitignore'
          && incomingHash && existingHash && incomingHash !== existingHash) {
          await fs.copyFile(src, dest + '.new');
          contractUpdates.push(normalized);
        }
        preserved.push(normalized);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
    return { tool, preserved, contractUpdates, pruned };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const { project, targets, outdir, manifest, mode, nativeOptions, force } = parseArgs(process.argv.slice(2));
    const config = await getConfig();

    let projectBody;
    try {
      projectBody = await fs.readFile(project, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new ExportError(`Project file not found: ${project}`);
      throw new ExportError(`Could not read ${project}: ${e.message}`);
    }
    // Validate it parses so we don't ship garbage to the service.
    let projectJson;
    try {
      projectJson = JSON.parse(projectBody);
    } catch (e) {
      throw new ExportError(`${project} is not valid JSON: ${e.message}`);
    }
    const requests = exportRequests(targets);
    for (const request of requests) {
      await performExport({
        config, projectJson, request, outdir, manifest, mode, nativeOptions, force, requestCount: requests.length,
      });
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof ExportError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

// Only run as a CLI entrypoint -- tests import extractProtected without triggering an export.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
