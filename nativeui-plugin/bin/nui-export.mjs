// nui-export.mjs — export a NativeUI project to a native (Android/iOS) project ZIP.
//
// POSTs the project JSON to <exportServiceUrl>/export/<platform> (or
// /export/<platform>/manifest with --manifest), streams the returned ZIP to
// <outdir>/<platform>-export.zip, and unzips it if `unzip` is available.
//
// By default the service emits the CLEAN, runnable PROD app. Pass --beta (or
// --mode beta) only for the internal capture harness.
//
// Usage:
//   node bin/nui-export.mjs <project.json> --platform android|ios -o <outdir> [--manifest] [--beta | --mode beta|prod]

import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getConfig, ConfigError } from './config.mjs';
import { AuthError } from './token.mjs';
import { exportServiceHeaders, exportServiceRejectedAuthMessage } from './auth-mode.mjs';

class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportError';
  }
}

const USAGE =
  'Usage: node bin/nui-export.mjs <project.json> --platform android|ios -o <outdir> [--manifest] [--beta | --prod | --mode beta|prod] [--app-name NAME] [--android-package ID] [--ios-bundle-id ID]';

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
  let outdir;
  let manifest = false;
  let mode = 'prod';
  const nativeOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' || a === '-p') {
      platform = requireValue(argv, i, a);
      i++;
    } else if (a === '-o' || a === '--output') {
      outdir = requireValue(argv, i, a);
      i++;
    } else if (a === '--manifest') {
      manifest = true;
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
  if (!platform) throw new ExportError(`Missing --platform.\n${USAGE}`);
  platform = platform.toLowerCase();
  if (platform !== 'android' && platform !== 'ios') {
    throw new ExportError(`--platform must be 'android' or 'ios' (got '${platform}').`);
  }
  if (!outdir) throw new ExportError(`Missing -o <outdir>.\n${USAGE}`);
  mode = String(mode || 'prod').toLowerCase();
  if (mode !== 'beta' && mode !== 'prod') {
    throw new ExportError(`--mode must be 'beta' or 'prod' (got '${mode}').`);
  }
  nativeOptions.mode = mode;
  return { project, platform, outdir, manifest, mode, nativeOptions };
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

async function main() {
  try {
    const { project, platform, outdir, manifest, mode, nativeOptions } = parseArgs(process.argv.slice(2));
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
    projectJson.nativeExportOptions = {
      ...(projectJson.nativeExportOptions || {}),
      ...nativeOptions,
    };
    projectBody = JSON.stringify(projectJson);

    const modeQuery = `?mode=${encodeURIComponent(mode)}`;
    const endpoint = manifest
      ? `${config.exportServiceUrl}/export/${platform}/manifest${modeQuery}`
      : `${config.exportServiceUrl}/export/${platform}${modeQuery}`;

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: await exportServiceHeaders(config, {
          'Content-Type': 'application/json',
          Accept: 'application/zip',
        }),
        body: projectBody,
      });
    } catch (e) {
      throw new ExportError(`Network error contacting export service: ${e.message}`);
    }

    if (!res.ok) {
      // Read the (likely JSON/text) error body for a clear message.
      const errText = await res.text().catch(() => '');
      const map = {
        400: 'Bad request: the project JSON was rejected by the exporter.',
        401: exportServiceRejectedAuthMessage(config, 'Export'),
        403: exportServiceRejectedAuthMessage(config, 'Export'),
        413: 'Project too large for the export service (HTTP 413). Reduce assets/pages and retry.',
      };
      const head = map[res.status] || `Export failed (HTTP ${res.status}).`;
      throw new ExportError(`${head}${errText ? `\n  ${errText.slice(0, 400)}` : ''}`);
    }

    await fs.mkdir(path.resolve(outdir), { recursive: true });
    // The manifest endpoint returns JSON (a file list), not a ZIP — name it accordingly.
    const outName = manifest ? `${platform}-manifest.json` : `${platform}-export.zip`;
    const outPath = path.join(path.resolve(outdir), outName);

    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(outPath, buf);
    } else {
      const nodeStream = Readable.fromWeb(res.body);
      await pipeline(nodeStream, createWriteStream(outPath));
    }

    const { size } = await fs.stat(outPath);
    if (size === 0) throw new ExportError('Export returned an empty response.');

    if (manifest) {
      process.stdout.write(`Wrote ${platform} manifest -> ${outPath} (${size} bytes)\n`);
      process.exit(0);
    }

    const unzippedWith = tryUnzip(outPath, path.resolve(outdir));
    process.stdout.write(`Exported ${platform} (${mode}) -> ${outPath} (${size} bytes)\n`);
    if (unzippedWith) {
      process.stdout.write(`  Unzipped into ${path.resolve(outdir)} (via ${unzippedWith})\n`);
    } else {
      process.stdout.write(
        `  (no extractor found — install unzip, python3, or tar; left the .zip in place)\n`
      );
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

main();
