// nui-run.mjs — build + install + LAUNCH an exported NativeUI app on the local
// Android emulator and/or iOS simulator. Runs the CLEAN/PROD app (animations
// auto-play, responsive @media divisions resolve at the device width, effects
// render, events/nav work) — NOT the parity harness.
//
// Two ways to point it at a project:
//   --project <dir>     an already-exported project tree (from `nui-export --prod`).
//                       Android: a dir with settings.gradle.kts. iOS: a dir with a *.xcodeproj.
//   <project.json>      a NativeUI project.json — nui-run first runs `nui-export --prod`
//                       into a temp/-o dir to produce the clean tree, then builds+launches it.
//
// Per platform it: detects the toolchain (adb/emulator | xcrun simctl/xcodebuild),
// finds or boots a device, builds, installs, and launches. If a platform's toolchain
// or device is unavailable it SKIPS that platform gracefully (prints how to open the
// project in Android Studio / Xcode) instead of failing the whole command.
//
// Target IDs cover the flagship and legacy mobile lanes, Rust and C# hosts, and
// every authored web/PWA lane. Missing local prerequisites are reported per target.
//
// Usage:
//   node bin/nui-run.mjs --project <dir> [--platform android|ios|both|rust|web]
//   node bin/nui-run.mjs <project.json> [--platform android|ios|both|rust|web] [-o <outdir>]
//   Flags: --platform android|ios|both (default both); rust = secondary opt-in target;
//          web = legacy alias for the authored vanilla web-html PWA
//          --rust-target host|ios-sim|web|android  (rust only; default host = the desktop window)
//          --project <dir>   exported tree (skip export)
//          -o, --output <dir> where to export when given a project.json (default ./nui-run-out)
//          --no-launch       build + install only, don't launch
//          --device <id>     android serial (e.g. emulator-5554) or iOS udid/name
//          -h, --help

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { resolveTargets } from './target-contract.mjs';
import {
  ExportManifestError,
  discoverExportManifests,
  readExportManifest,
  validateWebArtifacts,
} from './export-manifest.mjs';

class RunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunError';
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_SCRIPT = path.join(HERE, 'nui-export.mjs');

const USAGE = [
  'Usage:',
  '  node bin/nui-run.mjs --project <exported-dir> [--platform android|ios|both|rust|web]',
  '  node bin/nui-run.mjs <project.json> [--platform android|ios|both|rust|web] [-o <outdir>]',
  'Flags:',
  '  --target auto|<target-id|group>  repeatable full target selector (mobile by default)',
  '  --all-targets                  run every locally available target host',
  '  --platform android|ios|both   which devices to target (default both)',
  '  --platform rust               legacy alias for the Rust host target',
  '  --platform web                legacy alias for the authored vanilla web-html PWA',
  '  --rust-target host|ios-sim|web|android  rust only: host desktop window (default), iOS Simulator, browser (wasm), or Android device',
  '  --render-mode static|ssr      web delivery mode (default static; vanilla supports static only)',
  '  --project <dir>               an already-exported (prod) project tree; skip export',
  '  -o, --output <dir>            export dest when given a project.json (default ./nui-run-out)',
  '  --device <id>                 android serial or iOS udid/name to target',
  '  --no-launch                   build + install only',
].join('\n');

function parseArgs(argv) {
  let projectJson;
  let projectDir;
  let platform = 'both';
  let outdir = './nui-run-out';
  let device;
  let launch = true;
  let rustTarget; // undefined until explicitly set, so we can reject it for non-rust platforms
  let renderMode = 'static';
  const targetTokens = [];
  let allTargets = false;
  let sawPlatform = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' || a === '-p') {
      sawPlatform = true;
      platform = (argv[++i] || '').toLowerCase();
    } else if (a === '--target') {
      targetTokens.push((argv[++i] || '').toLowerCase());
    } else if (a === '--all-targets') {
      allTargets = true;
    } else if (a === '--rust-target') {
      rustTarget = (argv[++i] || '').toLowerCase();
    } else if (a === '--render-mode') {
      renderMode = (argv[++i] || '').toLowerCase();
    } else if (a === '--project') {
      projectDir = argv[++i];
    } else if (a === '-o' || a === '--output') {
      outdir = argv[++i];
    } else if (a === '--device') {
      device = argv[++i];
    } else if (a === '--no-launch') {
      launch = false;
    } else if (a === '-h' || a === '--help') {
      throw new RunError(USAGE);
    } else if (a.startsWith('-')) {
      throw new RunError(`Unknown flag: ${a}\n${USAGE}`);
    } else if (!projectJson && !projectDir) {
      projectJson = a;
    } else {
      throw new RunError(`Unexpected argument: ${a}\n${USAGE}`);
    }
  }
  if (!projectJson && !projectDir) {
    throw new RunError(`Provide a <project.json> or --project <dir>.\n${USAGE}`);
  }
  if (!['android', 'ios', 'both', 'rust', 'web'].includes(platform)) {
    throw new RunError(`--platform must be android|ios|both|rust|web (got '${platform}').`);
  }
  if (!['static', 'ssr'].includes(renderMode)) throw new RunError(`--render-mode must be static|ssr (got '${renderMode}').`);
  if (rustTarget !== undefined) {
    if (platform !== 'rust') {
      throw new RunError(`--rust-target only applies to --platform rust (got --platform ${platform}).`);
    }
    if (!['host', 'ios-sim', 'web', 'android'].includes(rustTarget)) {
      throw new RunError(`--rust-target must be host|ios-sim|web|android (got '${rustTarget}').`);
    }
  }
  if (platform === 'rust' && rustTarget === undefined) rustTarget = 'host';
  if ((targetTokens.length || allTargets) && sawPlatform) {
    throw new RunError('Use either --target/--all-targets or the legacy --platform selector, not both.');
  }
  const selectedTargets = targetTokens.length || allTargets
    ? resolveTargets(targetTokens, { allTargets, defaults: true })
    : [];
  return { projectJson, projectDir, platform, outdir, device, launch, rustTarget, renderMode, selectedTargets };
}

// ---- small process helpers -------------------------------------------------

// Run a command, inheriting stdio. Returns the exit status (or null on spawn error).
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) return { status: null, error: r.error };
  return { status: r.status };
}

// Run a command capturing stdout (trimmed). Returns { ok, out, status }.
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) return { ok: false, out: '', status: null, error: r.error };
  return { ok: r.status === 0, out: (r.stdout || '').trim(), status: r.status };
}

// Is a tool runnable on PATH? (probe spawns; a spawn error means "not found".)
function hasTool(cmd, probeArgs) {
  const probe = spawnSync(cmd, probeArgs, { stdio: 'ignore' });
  return !probe.error;
}

function existsSync(p) {
  try {
    return fsSync.existsSync(p);
  } catch {
    return false;
  }
}

// Candidate Android SDK roots, in preference order.
function androidSdkRoots() {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk'),
  ].filter(Boolean);
}

// The Android SDK root Gradle/AGP should use (first one that actually exists). Gradle needs this via
// ANDROID_HOME / ANDROID_SDK_ROOT (or sdk.dir in local.properties) to resolve build tools + platforms.
function resolveAndroidSdkRoot() {
  for (const root of androidSdkRoots()) {
    if (existsSync(path.join(root, 'platform-tools')) || existsSync(path.join(root, 'platforms'))) {
      return root;
    }
  }
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || null;
}

// Resolve an Android SDK tool: PATH first, then the SDK roots' <subdir>/<name>.
function resolveAndroidTool(name, subdir) {
  // On PATH? A bare spawn (no args) succeeds if the binary exists.
  if (!spawnSync(name, [], { stdio: 'ignore' }).error) return name;
  for (const root of androidSdkRoots()) {
    const p = path.join(root, subdir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

// ---- export-if-needed ------------------------------------------------------

async function ensureExported(projectJson, platform, outdir, selectedTargets = []) {
  if (selectedTargets.length) {
    const dirs = {};
    for (const target of selectedTargets) {
      const dest = path.resolve(outdir, target.id);
      process.stdout.write(`\n== Exporting ${target.id} (prod) -> ${dest} ==\n`);
      const r = run('node', [EXPORT_SCRIPT, projectJson, '--target', target.id, '-o', dest, '--prod']);
      if (r.status !== 0) throw new RunError(`nui-export --target ${target.id} failed (exit ${r.status}).`);
      dirs[target.id] = dest;
    }
    return dirs;
  }
  // Export each requested platform in PROD mode into outdir/<platform>.
  const platforms = platform === 'both' ? ['android', 'ios'] : [platform];
  const dirs = {};
  for (const plat of platforms) {
    const dest = path.resolve(outdir, plat);
    process.stdout.write(`\n== Exporting ${plat} (prod) -> ${dest} ==\n`);
    const r = run('node', [EXPORT_SCRIPT, projectJson, '--platform', plat, '-o', dest, '--prod']);
    if (r.status !== 0) {
      throw new RunError(
        `nui-export --prod failed for ${plat} (exit ${r.status}). See output above.`
      );
    }
    dirs[plat] = dest;
  }
  return dirs;
}

// Discover an exported project tree's platform + root inside a dir (handles the
// unzip-to-subdir case where the tree is one level down).
async function classifyProjectDir(dir) {
  const root = path.resolve(dir);
  const found = { android: null, ios: null, rust: null, csharp: null, web: null };
  // Schema-2 manifests are authoritative for target identity. In particular, never infer one
  // authored web lane from another lane's package.json or index.html.
  let manifestRecords = [];
  try {
    manifestRecords = discoverExportManifests(root);
  } catch (error) {
    if (error instanceof ExportManifestError) throw new RunError(error.message);
    throw error;
  }
  for (const record of manifestRecords) {
    for (const targetId of record.targetIds) {
      if (found[targetId] && found[targetId] !== record.root) {
        throw new RunError(`Multiple exported project roots declare ${targetId}.`);
      }
      found[targetId] = record.root;
    }
  }
  // BFS up to depth 2 so an `-o out` dir containing `android/` + `ios/` subdirs works.
  const queue = [{ p: root, depth: 0 }];
  while (queue.length) {
    const { p, depth } = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(p, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.map((e) => e.name);
    if (!found.android && names.includes('settings.gradle.kts')) found.android = p;
    const xcodeproj = entries.find((e) => e.isDirectory() && e.name.endsWith('.xcodeproj'));
    if (!found.ios && xcodeproj) found.ios = p;
    // The Rust lane emits ONE Cargo project at its root; a Cargo.toml with a src/ sibling
    // is the marker (guard on src/ so we don't latch onto a nested crate's manifest).
    if (!found.rust && names.includes('Cargo.toml') && names.includes('src')) found.rust = p;
    if (!found.csharp && names.some((name) => name.endsWith('.slnx'))) found.csharp = p;
    if (depth < 2) {
      for (const e of entries) {
        if (e.isDirectory() && !e.name.endsWith('.xcodeproj')) {
          queue.push({ p: path.join(p, e.name), depth: depth + 1 });
        }
      }
    }
  }
  return found;
}

function classifiedRootForExport(classified, exportKey, targets) {
  const target = targets.find((candidate) => candidate.id === exportKey)
    || (targets.length === 1 ? targets[0] : targets.find((candidate) => candidate.platform === exportKey));
  if (target?.platform === 'web') return { key: target.id, root: classified[target.id] || null };
  return { key: exportKey, root: classified[exportKey] || classified[target?.platform] || null };
}

async function runWeb(webRoot, { launch, targetId = 'web-html', renderMode = 'static' }) {
  const result = { platform: targetId, built: false, installed: false, launched: false, skipped: false, note: '', device: renderMode === 'ssr' ? 'node' : 'browser' };
  try {
    readExportManifest(webRoot, { targetId, renderMode });
  } catch (error) {
    result.note = error.message;
    return result;
  }
  const vanilla = targetId === 'web-html';
  if (vanilla) {
    const artifacts = validateWebArtifacts(webRoot, targetId, renderMode);
    if (!artifacts.valid) {
      result.note = `${targetId} ${renderMode} artifacts are missing: ${artifacts.missing.join(', ')}.`;
      return result;
    }
    result.built = true;
  } else {
    if (!existsSync(path.join(webRoot, 'package.json'))) {
      result.note = `${targetId} manifest root is missing package.json; refusing vanilla fallback.`;
      return result;
    }
    if (!hasTool('pnpm', ['--version'])) {
      result.skipped = true;
      result.note = 'pnpm is required for framework web targets.';
      return result;
    }
    if (!existsSync(path.join(webRoot, 'node_modules'))) {
      const install = run('pnpm', ['install', '--frozen-lockfile'], { cwd: webRoot });
      if (install.status !== 0) { result.note = `pnpm install failed (exit ${install.status}).`; return result; }
      result.installed = true;
    }
    const build = run('pnpm', [`build:${renderMode}`], { cwd: webRoot });
    if (build.status !== 0) { result.note = `pnpm build:${renderMode} failed (exit ${build.status}).`; return result; }
    const artifacts = validateWebArtifacts(webRoot, targetId, renderMode);
    if (!artifacts.valid) {
      result.note = `${targetId} build completed without exact ${renderMode} artifacts: ${artifacts.missing.join(', ')}.`;
      return result;
    }
    result.built = true;
  }
  if (!launch) {
    result.note = `${renderMode} build validated (--no-launch).`;
    return result;
  }
  if (!vanilla && renderMode === 'ssr') {
    const child = spawn('pnpm', ['start:ssr'], { cwd: webRoot, detached: true, stdio: 'ignore' });
    child.unref();
    result.launched = true;
    result.note = `SSR server started (pid ${child.pid}).`;
    return result;
  }
  const staticRoot = validateWebArtifacts(webRoot, targetId, 'static').staticOutputDir;
  if (!hasTool('python3', ['--version'])) {
    result.note = `PWA is ready at ${staticRoot}; python3 is unavailable, so start any static server there.`;
    return result;
  }
  const port = Number(process.env.NATIVEUI_WEB_PORT || 4173);
  const child = spawn('python3', ['-m', 'http.server', String(port), '--directory', staticRoot], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  const opener = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const opened = spawnSync(opener[0], opener[1], { stdio: 'ignore' });
  result.launched = !opened.error && opened.status === 0;
  result.note = `${url} (server pid ${child.pid})`;
  return result;
}

async function runCsharp(csharpRoot, { launch, targetId }) {
  const result = { platform: targetId, built: false, installed: false, launched: false, skipped: false, note: '' };
  if (!hasTool('dotnet', ['--version'])) {
    result.skipped = true;
    result.note = 'dotnet not found. Install the .NET SDK and the target workload reported by nui-doctor.';
    return result;
  }
  const framework = targetId === 'csharp-ios' ? 'net10.0-ios' : targetId === 'csharp-android' ? 'net10.0-android' : '';
  const projectFiles = [];
  const queue = [{ root: csharpRoot, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (current.depth > 3) continue;
    for (const entry of fsSync.readdirSync(current.root, { withFileTypes: true })) {
      const full = path.join(current.root, entry.name);
      if (entry.isDirectory() && !['bin', 'obj', 'Runtime'].includes(entry.name)) queue.push({ root: full, depth: current.depth + 1 });
      else if (entry.isFile() && entry.name.endsWith('.csproj')) projectFiles.push(full);
    }
  }
  const project = framework
    ? projectFiles.find((file) => fsSync.readFileSync(file, 'utf8').includes(`<TargetFramework>${framework}</TargetFramework>`))
    : projectFiles.find((file) => !file.includes(`${path.sep}Runtime${path.sep}`));
  if (!project) {
    result.skipped = true;
    result.note = `no ${framework || 'desktop'} generated host project found; inspect nativeui-export-manifest.json and re-export.`;
    return result;
  }
  const args = launch && framework ? ['build', project, '-t:Run']
    : launch ? ['run', '--project', project]
      : ['build', project];
  const built = run('dotnet', args, { cwd: csharpRoot });
  result.built = built.status === 0;
  result.launched = result.built && launch;
  if (!result.built) result.note = `dotnet ${args.join(' ')} failed.`;
  return result;
}

function legacyTargets(platform, rustTarget) {
  if (platform === 'both') return resolveTargets(['mobile']);
  if (platform === 'android') return resolveTargets(['android']);
  if (platform === 'ios') return resolveTargets(['ios']);
  if (platform === 'web') return resolveTargets(['web']);
  const id = rustTarget === 'ios-sim' ? 'rust-ios' : rustTarget === 'web' ? 'rust-web'
    : rustTarget === 'android' ? 'rust-android' : 'rust-desktop';
  return resolveTargets([id]);
}

function rustHostForTarget(targetId) {
  return targetId === 'rust-ios' ? 'ios-sim' : targetId === 'rust-web' ? 'web'
    : targetId === 'rust-android' ? 'android' : 'host';
}

// ============================================================================
// ANDROID
// ============================================================================

// Read the Gradle version the export pinned in gradle/wrapper/gradle-wrapper.properties (distributionUrl
// .../gradle-<version>-bin.zip). Used to regenerate the wrapper at the SAME version so AGP's min-version check
// passes.
async function readPinnedGradleVersion(androidRoot) {
  try {
    const props = await fs.readFile(
      path.join(androidRoot, 'gradle/wrapper/gradle-wrapper.properties'),
      'utf8'
    );
    const m = props.match(/gradle-([0-9][0-9A-Za-z.\-]*)-(?:bin|all)\.zip/);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return null;
}

async function readAndroidAppId(androidRoot) {
  // applicationId lives in app/build.gradle.kts (clean export parameterizes it).
  try {
    const gradle = await fs.readFile(path.join(androidRoot, 'app/build.gradle.kts'), 'utf8');
    const m = gradle.match(/applicationId\s*=\s*"([^"]+)"/);
    if (m) return m[1];
    const ns = gradle.match(/namespace\s*=\s*"([^"]+)"/);
    if (ns) return ns[1];
  } catch {
    /* fall through */
  }
  return 'com.nui.app';
}

function androidDevices(adb) {
  const r = capture(adb, ['devices']);
  if (!r.ok) return [];
  return r.out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
}

async function bootAndroidEmulator(emulatorBin, adb) {
  const list = capture(emulatorBin, ['-list-avds']);
  if (!list.ok || !list.out) return null;
  const avd = list.out.split('\n')[0].trim();
  if (!avd) return null;
  process.stdout.write(`  Booting AVD '${avd}' (this can take a minute)...\n`);
  // Detached: the emulator process must outlive this spawn.
  const child = spawn(emulatorBin, ['-avd', avd, '-no-snapshot-save', '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // Wait for a device to appear + finish booting (up to ~120s).
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const devs = androidDevices(adb);
    if (devs.length) {
      const serial = devs[0];
      const boot = capture(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      if (boot.ok && boot.out === '1') return serial;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function runAndroid(androidRoot, { device, launch }) {
  const result = { platform: 'android', built: false, installed: false, launched: false, skipped: false, note: '' };
  const adb = resolveAndroidTool('adb', 'platform-tools');
  if (!adb) {
    result.skipped = true;
    result.note = `adb not found. Install Android SDK platform-tools, then open the project in Android Studio:\n    ${androidRoot}`;
    return result;
  }

  // Pick / boot a device.
  let serial = device;
  if (!serial) {
    const devs = androidDevices(adb);
    serial = devs[0];
  }
  if (!serial) {
    const emu = resolveAndroidTool('emulator', 'emulator');
    if (emu) serial = await bootAndroidEmulator(emu, adb);
  }
  if (!serial) {
    result.skipped = true;
    result.note = `No booted Android device/emulator and none could be started. Open in Android Studio:\n    ${androidRoot}`;
    return result;
  }
  result.device = serial;

  // Build + install. The clean export ships gradle-wrapper.properties (pinning the exact Gradle version AGP
  // needs) but NOT the gradlew launcher + jar. Prefer ./gradlew if present; else, if a system `gradle` exists,
  // materialize the pinned wrapper with `gradle wrapper` (any gradle can generate a wrapper for a newer version)
  // and use ./gradlew so the right Gradle is downloaded; else fall back to running system gradle directly.
  const gradlew = path.join(androidRoot, 'gradlew');
  let gradleCmd = null;
  const haveSystemGradle = hasTool('gradle', ['--version']);
  if (existsSync(gradlew)) {
    gradleCmd = gradlew;
  } else if (haveSystemGradle) {
    // The exported gradle-wrapper.properties pins the exact Gradle version AGP needs. `gradle wrapper` WITHOUT
    // --gradle-version would rewrite distributionUrl to the (possibly older) system gradle's own version, so we
    // read the pinned version and pass it explicitly. Any gradle can generate a wrapper for a newer version.
    const pinned = await readPinnedGradleVersion(androidRoot);
    process.stdout.write(
      `  No ./gradlew — generating the pinned Gradle wrapper (${pinned || 'default'}) with system gradle...\n`
    );
    const wrapArgs = pinned ? ['wrapper', '--gradle-version', pinned, '--distribution-type', 'bin'] : ['wrapper'];
    const wrap = run('gradle', wrapArgs, { cwd: androidRoot });
    if (wrap.status === 0 && existsSync(gradlew)) {
      gradleCmd = gradlew;
    } else {
      // Wrapper generation failed; try the system gradle directly (may be too old, but let it report).
      gradleCmd = 'gradle';
    }
  }
  if (!gradleCmd) {
    result.skipped = true;
    result.note = `No Gradle (no ./gradlew and no system 'gradle'). Open in Android Studio (it provides one):\n    ${androidRoot}`;
    return result;
  }

  const appId = await readAndroidAppId(androidRoot);
  process.stdout.write(`\n== Android: building + installing ${appId} on ${serial} ==\n`);
  // installDebug builds the debug APK and installs on every connected device; pin to ours via ANDROID_SERIAL.
  // AGP needs the SDK location: surface it via ANDROID_HOME/ANDROID_SDK_ROOT (falls back to local.properties if a
  // user already wrote one). We don't write local.properties so the export tree stays clean.
  const sdkRoot = resolveAndroidSdkRoot();
  const env = { ...process.env, ANDROID_SERIAL: serial };
  if (sdkRoot) {
    env.ANDROID_HOME = sdkRoot;
    env.ANDROID_SDK_ROOT = sdkRoot;
  }
  const build = run(gradleCmd, [':app:installDebug'], { cwd: androidRoot, env });
  if (build.status !== 0) {
    result.note = `Gradle :app:installDebug failed (exit ${build.status}). Try opening in Android Studio:\n    ${androidRoot}`;
    return result;
  }
  result.built = true;
  result.installed = true;

  if (launch) {
    // Launch the LAUNCHER activity (.MainActivity). Use `monkey` as the no-component-name fallback.
    const start = run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', `${appId}/.MainActivity`], { env });
    if (start.status !== 0) {
      run(adb, ['-s', serial, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], { env });
    }
    result.launched = true;
    // Bring the emulator window forward + give it a moment to render.
    await sleep(1500);
  }
  return result;
}

// ============================================================================
// iOS
// ============================================================================

function simctlBootedUdid(device) {
  // If a name/udid is given, resolve it; else first booted, else first available iPhone.
  const json = capture('xcrun', ['simctl', 'list', 'devices', '--json']);
  if (!json.ok) return null;
  let parsed;
  try {
    parsed = JSON.parse(json.out);
  } catch {
    return null;
  }
  const all = [];
  for (const runtime of Object.keys(parsed.devices || {})) {
    for (const d of parsed.devices[runtime] || []) {
      all.push({ ...d, runtime });
    }
  }
  const avail = all.filter((d) => d.isAvailable !== false);
  if (device) {
    const match = avail.find((d) => d.udid === device || d.name === device);
    if (match) return { udid: match.udid, name: match.name, state: match.state };
  }
  const booted = avail.find((d) => d.state === 'Booted');
  if (booted) return { udid: booted.udid, name: booted.name, state: 'Booted' };
  return null;
}

function pickIphoneToBoot(device) {
  const json = capture('xcrun', ['simctl', 'list', 'devices', '--json']);
  if (!json.ok) return null;
  let parsed;
  try {
    parsed = JSON.parse(json.out);
  } catch {
    return null;
  }
  const all = [];
  for (const runtime of Object.keys(parsed.devices || {})) {
    for (const d of parsed.devices[runtime] || []) {
      if (d.isAvailable !== false) all.push(d);
    }
  }
  if (device) {
    const m = all.find((d) => d.udid === device || d.name === device);
    if (m) return m;
  }
  // Prefer a plain "iPhone 17", else any iPhone.
  return (
    all.find((d) => d.name === 'iPhone 17') ||
    all.find((d) => /^iPhone 1[6-9]$/.test(d.name)) ||
    all.find((d) => d.name.startsWith('iPhone')) ||
    null
  );
}

async function bootIosSimulator(device) {
  const target = pickIphoneToBoot(device);
  if (!target) return null;
  process.stdout.write(`  Booting iOS Simulator '${target.name}'...\n`);
  // Launch Simulator.app so the booted device is visible, then boot the device.
  run('open', ['-a', 'Simulator']);
  capture('xcrun', ['simctl', 'boot', target.udid]); // no-op if already booting
  // Wait for boot.
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const b = simctlBootedUdid(target.udid);
    if (b && b.state === 'Booted') return b;
  }
  // Even if not "Booted" yet, return the udid so the install can `simctl bootstatus`.
  return { udid: target.udid, name: target.name, state: 'Booting' };
}

function findXcodeproj(iosRoot) {
  const r = capture('bash', ['-lc', `ls -d "${iosRoot}"/*.xcodeproj 2>/dev/null | head -1`]);
  if (r.ok && r.out) return r.out.split('\n')[0].trim();
  return null;
}

async function iosBundleId(iosRoot) {
  // The clean Info.plist carries CFBundleIdentifier; the target is <App>/Info.plist.
  const r = capture('bash', [
    '-lc',
    `for plist in "${iosRoot}"/*/Info.plist; do /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null && break; done`,
  ]);
  if (r.ok && r.out && !r.out.includes('$(')) return r.out.split('\n')[0].trim();
  return 'com.nui.app';
}

async function runIos(iosRoot, { device, launch }) {
  const result = { platform: 'ios', built: false, installed: false, launched: false, skipped: false, note: '' };
  if (process.platform !== 'darwin' || !hasTool('xcrun', ['simctl', 'help'])) {
    result.skipped = true;
    result.note = `xcrun simctl unavailable (need macOS + Xcode). Open the project in Xcode:\n    ${iosRoot}`;
    return result;
  }
  const xcodeproj = findXcodeproj(iosRoot);
  if (!xcodeproj) {
    result.skipped = true;
    result.note = `No .xcodeproj under ${iosRoot} (was it exported with --prod?). Open in Xcode after re-exporting.`;
    return result;
  }
  // Scheme name == the .xcodeproj basename (the clean exporter writes <App>.xcscheme).
  const scheme = path.basename(xcodeproj, '.xcodeproj');

  // Find / boot a simulator.
  let sim = simctlBootedUdid(device);
  if (!sim) sim = await bootIosSimulator(device);
  if (!sim) {
    result.skipped = true;
    result.note = `No booted iOS Simulator and none could be started. Open in Xcode:\n    ${iosRoot}`;
    return result;
  }
  result.device = `${sim.name} (${sim.udid})`;
  // Ensure fully booted before install.
  capture('xcrun', ['simctl', 'bootstatus', sim.udid, '-b']);

  // Build for the simulator. No code signing needed for a sim build.
  const derived = path.join(iosRoot, '.nui-run-derived');
  process.stdout.write(`\n== iOS: building scheme ${scheme} for the simulator ==\n`);
  const build = run('xcodebuild', [
    'build',
    '-project', xcodeproj,
    '-scheme', scheme,
    '-sdk', 'iphonesimulator',
    '-configuration', 'Debug',
    '-destination', `platform=iOS Simulator,id=${sim.udid}`,
    '-derivedDataPath', derived,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
  ]);
  if (build.status !== 0) {
    result.note = `xcodebuild failed (exit ${build.status}). Open in Xcode to inspect:\n    ${xcodeproj}`;
    return result;
  }
  result.built = true;

  // Locate the built .app.
  const appPath = capture('bash', [
    '-lc',
    `ls -d "${derived}"/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1`,
  ]);
  if (!appPath.ok || !appPath.out) {
    result.note = `Build succeeded but no .app found under ${derived}/Build/Products. Open in Xcode.`;
    return result;
  }
  const app = appPath.out.split('\n')[0].trim();
  const bundleId = await iosBundleId(iosRoot);

  process.stdout.write(`  Installing ${app} on ${sim.name}...\n`);
  const inst = run('xcrun', ['simctl', 'install', sim.udid, app]);
  if (inst.status !== 0) {
    result.note = `simctl install failed (exit ${inst.status}).`;
    return result;
  }
  result.installed = true;

  if (launch) {
    run('open', ['-a', 'Simulator']);
    const lr = run('xcrun', ['simctl', 'launch', sim.udid, bundleId]);
    if (lr.status !== 0) {
      result.note = `Installed but simctl launch failed for ${bundleId} (exit ${lr.status}).`;
      return result;
    }
    result.launched = true;
    result.bundleId = bundleId;
    await sleep(1500);
  }
  return result;
}

// ============================================================================
// RUST (secondary opt-in target: one cross-platform Cargo project)
// ============================================================================

// The rustup launcher (~/.cargo/bin/rustup, then PATH). We ask rustup for the active
// toolchain's cargo so we bypass a stray Homebrew `cargo` that may shadow rustup on PATH.
function resolveRustup() {
  const homeRustup = path.join(os.homedir(), '.cargo', 'bin', 'rustup');
  if (existsSync(homeRustup)) return homeRustup;
  if (hasTool('rustup', ['--version'])) return 'rustup';
  return null;
}

// Resolve the cargo binary to use, preferring rustup's active toolchain over any PATH cargo
// (a Homebrew cargo has been observed to shadow rustup and pick a wrong toolchain).
// Order: $CARGO -> `rustup which cargo` -> scan $RUSTUP_HOME/toolchains -> PATH cargo.
function resolveCargo() {
  if (process.env.CARGO && existsSync(process.env.CARGO)) return process.env.CARGO;
  const rustup = resolveRustup();
  if (rustup) {
    const r = capture(rustup, ['which', 'cargo']);
    if (r.ok && r.out) {
      const p = r.out.split('\n')[0].trim();
      if (existsSync(p)) return p;
    }
  }
  const rustupHome = process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup');
  const toolchains = path.join(rustupHome, 'toolchains');
  let preferred = null;
  try {
    const settings = fsSync.readFileSync(path.join(rustupHome, 'settings.toml'), 'utf8');
    const m = settings.match(/default_toolchain\s*=\s*"([^"]+)"/);
    if (m) preferred = m[1];
  } catch {
    /* no settings.toml */
  }
  try {
    const dirs = fsSync
      .readdirSync(toolchains, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const ordered = preferred ? [preferred, ...dirs.filter((d) => d !== preferred)] : dirs;
    for (const d of ordered) {
      const cargo = path.join(toolchains, d, 'bin', 'cargo');
      if (existsSync(cargo)) return cargo;
    }
  } catch {
    /* no toolchains dir */
  }
  if (hasTool('cargo', ['--version'])) return 'cargo'; // last resort: PATH cargo
  return null;
}

// Run the Rust lane. host: `cargo build` then `cargo run` (a desktop window; blocks until the
// user closes it). ios-sim: boot a Simulator, then shell the exported build-ios.sh in `simulator`
// mode (it cross-compiles the Cocoa staticlib's Simulator slice, builds the XcodeGen UIKit host,
// installs + launches on the booted Simulator).
async function runRust(rustRoot, { launch, rustTarget, device }) {
  const result = {
    platform: `rust/${rustTarget}`,
    built: false,
    installed: false,
    launched: false,
    skipped: false,
    note: '',
  };
  const cargo = resolveCargo();
  if (!cargo) {
    result.skipped = true;
    result.note = `no Rust toolchain found (install rustup: https://rustup.rs), then: cd ${rustRoot} && cargo run`;
    return result;
  }
  // Prepend the resolved cargo's dir + set $CARGO so any bare-`cargo` script uses the same toolchain.
  const cargoBin = path.dirname(cargo);
  const rustEnv = {
    ...process.env,
    PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ''}`,
    CARGO: cargo,
  };
  const manifest = path.join(rustRoot, 'Cargo.toml');
  // Perf Stage 0 item 0a: build/run RELEASE by default -- the workspace's `dev` profile has no
  // CPU-side deadline (see nui-rust-runtime/Cargo.toml's Perf Stage 0 comment) and a debug build
  // of the editor reads as "laggy" for reasons that have nothing to do with the Rust port itself.
  // Set NATIVEUI_RUST_DEBUG=1 to get the old plain-`cargo build`/`cargo run` debug behavior back
  // (fast iteration while touching this lane itself).
  const releaseArgs = process.env.NATIVEUI_RUST_DEBUG ? [] : ['--release'];

  if (rustTarget === 'ios-sim') {
    if (process.platform !== 'darwin' || !hasTool('xcrun', ['simctl', 'help'])) {
      result.skipped = true;
      result.note = `--rust-target ios-sim needs macOS + Xcode (xcrun simctl). On the host: cd ${rustRoot} && cargo run`;
      return result;
    }
    const script = path.join(rustRoot, 'scripts', 'build-ios.sh');
    if (!existsSync(script)) {
      result.skipped = true;
      result.note = `no scripts/build-ios.sh under ${rustRoot} (re-export with --platform rust).`;
      return result;
    }
    // The script (in `simulator` mode) installs+launches on the CURRENTLY-BOOTED simulator; make
    // sure one is booted.
    let sim = simctlBootedUdid(device);
    if (!sim) sim = await bootIosSimulator(device);
    if (!sim) {
      result.skipped = true;
      result.note = `no booted iOS Simulator and none could be started. Boot one, then: bash ${script} simulator`;
      return result;
    }
    result.device = `${sim.name} (${sim.udid})`;
    capture('xcrun', ['simctl', 'bootstatus', sim.udid, '-b']);
    run('open', ['-a', 'Simulator']);
    process.stdout.write(`\n== Rust (ios-sim): building + installing via ${path.basename(script)} simulator ==\n`);
    const r = run('bash', [script, 'simulator'], { cwd: rustRoot, env: rustEnv });
    if (r.status !== 0) {
      result.note = `build-ios.sh simulator failed (exit ${r.status}). Needs: Xcode + XcodeGen (brew install xcodegen) + rustup target add aarch64-apple-ios-sim. Inspect: cd ${rustRoot} && bash scripts/build-ios.sh simulator`;
      return result;
    }
    result.built = true;
    result.installed = true;
    result.launched = true; // the script ends with `xcrun simctl launch`
    return result;
  }

  if (rustTarget === 'web') {
    // web: shell the exported scripts/build-web.sh (wasm32 release -> wasm-bindgen --target web ->
    // web/pkg/), then serve web/ statically and open the browser. The wasm bundle is driven by
    // nui-rt-web's WebShell, which runs the SAME full nui-rt app driver as every other target.
    const script = path.join(rustRoot, 'scripts', 'build-web.sh');
    if (!existsSync(script)) {
      result.skipped = true;
      result.note = `no scripts/build-web.sh under ${rustRoot} (re-export with --platform rust).`;
      return result;
    }
    process.stdout.write(`\n== Rust (web): building the wasm bundle via ${path.basename(script)} ==\n`);
    const r = run('bash', [script], { cwd: rustRoot, env: rustEnv });
    if (r.status !== 0) {
      result.note = `build-web.sh failed (exit ${r.status}). Needs: rustup target add wasm32-unknown-unknown (the script auto-installs wasm-bindgen-cli). Inspect: cd ${rustRoot} && bash scripts/build-web.sh`;
      return result;
    }
    result.built = true;
    result.device = 'browser (wasm)';
    const webDir = path.join(rustRoot, 'web');
    if (!launch) {
      result.note = `built only (--no-launch). Serve it with: cd ${webDir} && python3 -m http.server 8000`;
      return result;
    }
    if (!hasTool('python3', ['--version'])) {
      result.note = `wasm bundle built at ${webDir}. python3 not found to serve it — serve web/ with any static file server, then open the page.`;
      return result;
    }
    const url = 'http://localhost:8000/';
    // Open the browser best-effort AFTER the server is up (1s), detached so it never blocks; then
    // serve in the foreground -- this window stays open until Ctrl-C, mirroring the host `cargo run`.
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      spawn('sh', ['-c', `sleep 1 && ${opener} ${url} >/dev/null 2>&1`], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } catch { /* opening the browser is best-effort */ }
    process.stdout.write(`\n== Rust (web): serving ${webDir} at ${url} (Ctrl-C to stop) ==\n`);
    run('python3', ['-m', 'http.server', '8000'], { cwd: webDir, env: rustEnv });
    result.launched = true;
    return result;
  }

  if (rustTarget === 'android') {
    // android: shell the exported scripts/build-android.sh (cargo-ndk builds the crate's cdylib
    // lib<app>.so into jniLibs, then Gradle assembles the APK), then adb install + launch. The .so
    // is driven by nui-rt-android's shell, running the SAME full nui-rt app driver as every target.
    const script = path.join(rustRoot, 'scripts', 'build-android.sh');
    if (!existsSync(script)) {
      result.skipped = true;
      result.note = `no scripts/build-android.sh under ${rustRoot} (re-export with --platform rust).`;
      return result;
    }
    process.stdout.write(`\n== Rust (android): building via ${path.basename(script)} (cargo-ndk + gradle) ==\n`);
    const r = run('bash', [script], { cwd: rustRoot, env: rustEnv });
    if (r.status !== 0) {
      result.note = `build-android.sh failed (exit ${r.status}). Needs: Android NDK + \`cargo install cargo-ndk\` + \`rustup target add aarch64-linux-android\` + Gradle/SDK. Inspect: cd ${rustRoot} && bash scripts/build-android.sh`;
      return result;
    }
    result.built = true;
    result.device = 'android';
    const apk = path.join(rustRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (!launch) {
      result.note = `built ${apk}. Install with: adb install -r "${apk}"`;
      return result;
    }
    const adb = resolveAndroidTool('adb', 'platform-tools');
    if (!adb) {
      result.note = `APK built at ${apk}. adb not found — install Android SDK platform-tools, then: adb install -r "${apk}"`;
      return result;
    }
    let serial = device || androidDevices(adb)[0];
    if (!serial) {
      const emu = resolveAndroidTool('emulator', 'emulator');
      if (emu) serial = await bootAndroidEmulator(emu, adb);
    }
    if (!serial) {
      result.note = `APK built but no Android device/emulator is booted. Boot one, then: adb install -r "${apk}"`;
      return result;
    }
    result.device = serial;
    const inst = run(adb, ['-s', serial, 'install', '-r', apk]);
    if (inst.status !== 0) {
      result.note = `adb install failed (exit ${inst.status}). APK: ${apk}`;
      return result;
    }
    result.installed = true;
    const appId = await readAndroidAppId(path.join(rustRoot, 'android'));
    if (appId) {
      run(adb, ['-s', serial, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
      result.launched = true;
    } else {
      result.note = `installed, but couldn't read the applicationId to launch — start it from the launcher.`;
    }
    return result;
  }

  // host: build first (so a build failure reads distinctly from a run failure), then the window.
  process.stdout.write(`\n== Rust (host): cargo build${releaseArgs.length ? ' --release' : ''} in ${rustRoot} ==\n`);
  const build = run(cargo, ['build', ...releaseArgs, '--manifest-path', manifest], { env: rustEnv });
  if (build.status !== 0) {
    result.note = `cargo build failed (exit ${build.status}). Inspect: cd ${rustRoot} && cargo build ${releaseArgs.join(' ')}`;
    return result;
  }
  result.built = true;
  result.device = 'host desktop';
  if (!launch) {
    result.note = `built only (--no-launch). Run it with: cd ${rustRoot} && cargo run ${releaseArgs.join(' ')}`;
    return result;
  }
  process.stdout.write(`\n== Rust (host): cargo run${releaseArgs.length ? ' --release' : ''} (this window stays open until you close the app) ==\n`);
  const runR = run(cargo, ['run', ...releaseArgs, '--manifest-path', manifest], { env: rustEnv });
  if (runR.error) {
    result.note = `could not launch cargo: ${runR.error.message}`;
    return result;
  }
  if (runR.status !== 0 && runR.status !== null) {
    result.note = `cargo run exited ${runR.status}.`;
    return result;
  }
  result.launched = true;
  return result;
}

// ============================================================================

function reportLine(r) {
  if (r.skipped) return `  SKIPPED ${r.platform}: ${r.note}`;
  const stages = [];
  if (r.built) stages.push('built');
  if (r.installed) stages.push('installed');
  if (r.launched) stages.push('launched');
  const where = r.device ? ` on ${r.device}` : '';
  const head = stages.length
    ? `  ${r.platform}: ${stages.join(' + ')}${where}`
    : `  ${r.platform}: did not build${where}`;
  return r.note ? `${head}\n    note: ${r.note}` : head;
}

async function main() {
  try {
    const { projectJson, projectDir, platform, outdir, device, launch, rustTarget, renderMode, selectedTargets } = parseArgs(process.argv.slice(2));
    const targets = selectedTargets.length ? selectedTargets : legacyTargets(platform, rustTarget);

    // Resolve the exported tree(s) to build.
    let roots; // { android?: dir, ios?: dir, rust?: dir }
    if (projectDir) {
      roots = await classifyProjectDir(projectDir);
      if (!Object.values(roots).some(Boolean)) {
        throw new RunError(
          `--project ${projectDir} has no recognizable NativeUI Android, iOS, Rust, C#, or web project tree.\n` +
            `Export one first: node bin/nui-export.mjs <project.json> --target <target-id> -o <dir> --prod`
        );
      }
    } else {
      const dirs = await ensureExported(projectJson, platform, outdir, selectedTargets);
      roots = {};
      for (const [plat, dir] of Object.entries(dirs)) {
        const c = await classifyProjectDir(dir);
        const resolved = classifiedRootForExport(c, plat, targets);
        roots[resolved.key] = resolved.root;
      }
    }

    const results = [];

    for (const target of targets) {
      const root = roots[target.id] || (target.platform === 'web' ? null : roots[target.platform]);
      if (!root) {
        if (target.platform === 'web') {
          throw new RunError(
            `No schema-2 export manifest under ${path.resolve(projectDir || outdir)} declares ${target.id}; refusing lane fallback.`,
          );
        }
        results.push({ platform: target.id, skipped: true, note: `no ${target.generatedUi} project tree to run.` });
        continue;
      }
      let result;
      if (target.platform === 'android') result = await runAndroid(root, { device, launch });
      else if (target.platform === 'ios') result = await runIos(root, { device, launch });
      else if (target.platform === 'rust') result = await runRust(root, { launch, rustTarget: rustHostForTarget(target.id), device });
      else if (target.platform === 'csharp') result = await runCsharp(root, { launch, targetId: target.id });
      else result = await runWeb(root, { launch, targetId: target.id, renderMode });
      result.platform = target.id;
      results.push(result);
    }

    process.stdout.write('\n== nui-run summary ==\n');
    for (const r of results) {
      process.stdout.write(reportLine(r) + '\n');
    }

    // Exit non-zero only if EVERY requested platform failed to even build (a pure skip is success-with-note).
    const anyProgress = results.some((r) => r.built || r.installed || r.launched || r.skipped);
    const anyHardFail = results.some((r) => !r.skipped && !r.built);
    if (!anyProgress || anyHardFail) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof RunError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

// Exported for unit tests; running as a CLI entrypoint still invokes main().
export { parseArgs, classifyProjectDir, classifiedRootForExport, resolveCargo, runWeb };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
