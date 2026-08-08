#!/usr/bin/env node
// Report local NativeUI target readiness without installing or mutating anything.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTargets } from './target-contract.mjs';

const USAGE = 'Usage: node bin/nui-doctor.mjs [--target <id|group>...] [--all-targets] [--release] [--json|--human] [--no-fail]';

function parseArgs(argv) {
  const tokens = [];
  let allTargets = false;
  let release = false;
  let format = 'human';
  let noFail = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') tokens.push(argv[++i] || '');
    else if (arg === '--all-targets') allTargets = true;
    else if (arg === '--release') release = true;
    else if (arg === '--json') format = 'json';
    else if (arg === '--human') format = 'human';
    else if (arg === '--no-fail') noFail = true;
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return { targets: resolveTargets(tokens, { allTargets, defaults: true }), release, format, noFail };
}

function command(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: !result.error && result.status === 0,
    detail: result.error?.code === 'ENOENT' ? 'not found' : String(result.stdout || result.stderr || '').trim().split('\n')[0],
  };
}

function commandContains(commandName, args, pattern) {
  const result = spawnSync(commandName, args, { encoding: 'utf8' });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const lines = output.trim().split('\n');
  const matchingLine = lines.find((line) => {
    pattern.lastIndex = 0;
    return pattern.test(line.trim());
  });
  return {
    ok: !result.error && result.status === 0 && Boolean(matchingLine),
    detail: result.error?.code === 'ENOENT' ? 'not found' : matchingLine?.trim() || lines[0] || 'required entry not installed',
  };
}

function configuredFile(...names) {
  const value = names.map((name) => process.env[name]).find(Boolean);
  return { ok: Boolean(value && fs.existsSync(path.resolve(value))), detail: value ? (fs.existsSync(path.resolve(value)) ? 'protected file found' : 'configured file not found') : 'not configured' };
}

function androidTool(name, subdir) {
  const direct = command(name, ['version']);
  if (direct.ok) return direct;
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk')].filter(Boolean)) {
    const candidate = path.join(root, subdir, name);
    if (fs.existsSync(candidate)) return command(candidate, ['version']);
  }
  return direct;
}

function androidToolContains(name, subdir, args, pattern) {
  const direct = commandContains(name, args, pattern);
  if (direct.ok) return direct;
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk')].filter(Boolean)) {
    const candidate = path.join(root, subdir, name);
    if (fs.existsSync(candidate)) return commandContains(candidate, args, pattern);
  }
  return direct;
}

function environmentChecks({ release = false } = {}) {
  const credentialFile = path.join(os.homedir(), '.nativeui', 'credentials.json');
  const checks = [
    { id: 'nativeui-service-url', required: false, ok: true, detail: process.env.NATIVEUI_EXPORT_SERVICE_URL ? 'environment override configured' : 'built-in NativeUI dev service' },
    { id: 'nativeui-auth', required: false, ok: Boolean(process.env.NATIVEUI_ACCESS_TOKEN || process.env.NATIVEUI_API_TOKEN || fs.existsSync(credentialFile)), detail: process.env.NATIVEUI_ACCESS_TOKEN || process.env.NATIVEUI_API_TOKEN ? 'configured in environment' : fs.existsSync(credentialFile) ? 'cached SSO session found; preflight still required' : 'run the NativeUI login/preflight flow before hosted export' },
  ];
  if (release) {
    for (const [id, tool, remedy] of [
      ['vercel-cli', 'vercel', 'Install only when deploying to Vercel.'],
      ['netlify-cli', 'netlify', 'Install only when deploying to Netlify.'],
      ['fastlane', 'fastlane', 'Install for Play/App Store upload automation.'],
      ['docker', 'docker', 'Install for container-backed server deployment.'],
    ]) {
      const result = command(tool, ['--version']);
      checks.push({ id, required: false, ok: result.ok, detail: result.detail, remedy: result.ok ? '' : remedy });
    }
  }
  return checks;
}

export function inspectTarget(target, { release = false } = {}) {
  const checks = [];
  const add = (id, required, result, remedy) => checks.push({ id, required, ok: result.ok, detail: result.detail, remedy: result.ok ? '' : remedy });
  add('node', true, command('node', ['--version']), 'Install Node.js 18 or newer.');
  if (target.id.startsWith('ios-')) {
    add('xcodebuild', true, command('xcodebuild', ['-version']), 'Install/select Xcode.');
    add('simctl', !release, commandContains('xcrun', ['simctl', 'list', 'devices', 'available'], /\((?:Booted|Shutdown)\)/), 'Install an available iOS Simulator runtime or connect a device.');
    if (release) {
      add('apple-team', true, { ok: Boolean(process.env.DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID), detail: 'team identifier presence only' }, 'Set the Apple development team through environment/build settings.');
      add('apple-signing-identity', true, commandContains('security', ['find-identity', '-p', 'codesigning', '-v'], /\d+\) [0-9A-F]+/), 'Install a valid code-signing identity in the keychain.');
    }
  } else if (target.id.startsWith('android-')) {
    add('java', true, command('java', ['-version']), 'Install a JDK compatible with the generated Gradle project.');
    add('adb', !release, androidTool('adb', 'platform-tools'), 'Install Android SDK platform-tools.');
    if (!release) add('android-device', true, androidToolContains('adb', 'platform-tools', ['devices'], /\tdevice\b/), 'Start an emulator or connect an authorized Android device.');
    if (release) add('android-signing', true, configuredFile('RELEASE_STORE_FILE', 'ANDROID_KEYSTORE'), 'Provide a protected release keystore file.');
  } else if (target.id.startsWith('rust-')) {
    add('rustc', true, command('rustc', ['--version']), 'Install Rust with rustup.');
    add('cargo', true, command('cargo', ['--version']), 'Install Cargo with Rust.');
    if (target.id === 'rust-web') {
      add('wasm-target', true, commandContains('rustup', ['target', 'list', '--installed'], /^wasm32-unknown-unknown$/m), 'Install wasm32-unknown-unknown with rustup.');
      add('wasm-bindgen', true, command('wasm-bindgen', ['--version']), 'Install wasm-bindgen-cli.');
    }
    if (target.id === 'rust-ios') {
      add('xcodebuild', true, command('xcodebuild', ['-version']), 'Install/select Xcode.');
      add('rust-ios-target', true, commandContains('rustup', ['target', 'list', '--installed'], /^(?:aarch64-apple-ios|aarch64-apple-ios-sim|x86_64-apple-ios)$/m), 'Install the required Rust iOS target.');
      if (release) add('apple-team', true, { ok: Boolean(process.env.DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID), detail: 'team identifier presence only' }, 'Set the Apple development team.');
    }
    if (target.id === 'rust-android') {
      const ndk = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
      add('android-ndk', true, { ok: Boolean(ndk && fs.existsSync(ndk)), detail: ndk ? (fs.existsSync(ndk) ? 'NDK directory found' : 'configured NDK directory not found') : 'not configured' }, 'Set ANDROID_NDK_HOME to an installed NDK.');
      add('cargo-ndk', true, command('cargo', ['ndk', '--version']), 'Install cargo-ndk.');
      if (release) add('android-signing', true, configuredFile('RELEASE_STORE_FILE', 'ANDROID_KEYSTORE'), 'Provide a protected release keystore file.');
    }
  } else if (target.id.startsWith('csharp-')) {
    add('dotnet', true, command('dotnet', ['--version']), 'Install the .NET 10 SDK.');
    if (target.id === 'csharp-ios') {
      add('dotnet-ios-workload', true, commandContains('dotnet', ['workload', 'list'], /(?:^|\s)(?:ios|maui-ios)(?:\s|$)/m), 'Install the .NET iOS workload.');
      add('xcodebuild', true, command('xcodebuild', ['-version']), 'Install/select Xcode.');
      if (release) add('apple-team', true, { ok: Boolean(process.env.DEVELOPMENT_TEAM || process.env.APPLE_TEAM_ID), detail: 'team identifier presence only' }, 'Set the Apple development team.');
    }
    if (target.id === 'csharp-android') {
      add('dotnet-android-workload', true, commandContains('dotnet', ['workload', 'list'], /(?:^|\s)(?:android|maui-android)(?:\s|$)/m), 'Install the .NET Android workload.');
      if (release) add('android-signing', true, configuredFile('RELEASE_STORE_FILE', 'ANDROID_KEYSTORE'), 'Provide a protected release keystore file.');
    }
  } else if (target.id === 'web-html') {
    add('browser', true, { ok: true, detail: 'modern browser required at runtime' }, '');
    add('static-server', false, command('python3', ['--version']), 'Use any static HTTP server.');
  } else if (target.id.startsWith('web-')) {
    add('node-lts', true, commandContains('node', ['--version'], /^v24\.(?:1[6-9]|[2-9]\d)\.\d+$/), 'Install Node.js >=24.16.0 and <25; controlled web releases use Node 24.18.0 LTS.');
    add('pnpm', true, commandContains('pnpm', ['--version'], /^11\.15\.0$/), 'Install the pinned pnpm 11.15.0 release.');
    add('browser', true, { ok: true, detail: 'modern browser required at runtime' }, '');
  }
  const blockers = checks.filter((check) => check.required && !check.ok);
  return { targetId: target.id, releaseStatus: target.releaseStatus, ready: blockers.length === 0, blockers: blockers.length, checks };
}

function main() {
try {
  const opts = parseArgs(process.argv.slice(2));
  const targets = opts.targets.map((target) => inspectTarget(target, opts));
  const environment = environmentChecks(opts);
  const report = { schemaVersion: 2, release: opts.release, ready: targets.every((target) => target.ready), environment, targets };
  if (opts.format === 'json') process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    process.stdout.write('NativeUI environment\n');
    for (const check of environment) process.stdout.write(`  ${check.ok ? 'ok' : 'optional'} ${check.id}: ${check.detail || check.remedy}\n`);
    for (const target of targets) {
      process.stdout.write(`${target.ready ? 'READY' : 'BLOCKED'} ${target.targetId} (${target.releaseStatus})\n`);
      for (const check of target.checks) process.stdout.write(`  ${check.ok ? 'ok' : check.required ? 'BLOCKER' : 'optional'} ${check.id}: ${check.detail || check.remedy}\n`);
    }
  }
  if (!report.ready && !opts.noFail) process.exit(1);
} catch (error) {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
