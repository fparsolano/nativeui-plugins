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
// Usage:
//   node bin/nui-run.mjs --project <dir> [--platform android|ios|both]
//   node bin/nui-run.mjs <project.json> [--platform android|ios|both] [-o <outdir>]
//   Flags: --platform android|ios|both (default both)
//          --project <dir>   exported tree (skip export)
//          -o, --output <dir> where to export when given a project.json (default ./nui-run-out)
//          --no-launch       build + install only, don't launch
//          --device <id>     android serial (e.g. emulator-5554) or iOS udid/name
//          -h, --help

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

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
  '  node bin/nui-run.mjs --project <exported-dir> [--platform android|ios|both]',
  '  node bin/nui-run.mjs <project.json> [--platform android|ios|both] [-o <outdir>]',
  'Flags:',
  '  --platform android|ios|both   which devices to target (default both)',
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' || a === '-p') {
      platform = (argv[++i] || '').toLowerCase();
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
  if (!['android', 'ios', 'both'].includes(platform)) {
    throw new RunError(`--platform must be android|ios|both (got '${platform}').`);
  }
  return { projectJson, projectDir, platform, outdir, device, launch };
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

async function ensureExported(projectJson, platform, outdir) {
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
  const found = { android: null, ios: null };
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
    const { projectJson, projectDir, platform, outdir, device, launch } = parseArgs(process.argv.slice(2));

    // Resolve the exported tree(s) to build.
    let roots; // { android?: dir, ios?: dir }
    if (projectDir) {
      roots = await classifyProjectDir(projectDir);
      if (!roots.android && !roots.ios) {
        throw new RunError(
          `--project ${projectDir} has no Android (settings.gradle.kts) or iOS (*.xcodeproj) project tree.\n` +
            `Export one first: node bin/nui-export.mjs <project.json> --platform <p> -o <dir> --prod`
        );
      }
    } else {
      const dirs = await ensureExported(projectJson, platform, outdir);
      roots = {};
      for (const [plat, dir] of Object.entries(dirs)) {
        const c = await classifyProjectDir(dir);
        roots[plat] = c[plat];
      }
    }

    const wantAndroid = platform === 'both' || platform === 'android';
    const wantIos = platform === 'both' || platform === 'ios';
    const results = [];

    if (wantAndroid) {
      if (roots.android) {
        results.push(await runAndroid(roots.android, { device, launch }));
      } else {
        results.push({ platform: 'android', skipped: true, note: 'no Android project tree to run.' });
      }
    }
    if (wantIos) {
      if (roots.ios) {
        results.push(await runIos(roots.ios, { device, launch }));
      } else {
        results.push({ platform: 'ios', skipped: true, note: 'no iOS project tree to run.' });
      }
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

main();
