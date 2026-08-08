// helpers.mjs — shared test helpers (pure Node, node:test). No external deps.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_DIR = path.resolve(TEST_DIR, '..');
export const BIN_DIR = path.join(PLUGIN_DIR, 'bin');
export const FIXTURES = path.join(TEST_DIR, 'fixtures');

export function bin(name) {
  return path.join(BIN_DIR, name);
}

export function fixture(name) {
  return path.join(FIXTURES, name);
}

/**
 * An env with EVERY NativeUI config stripped and HOME pointed at an empty temp dir,
 * so any command that needs config/auth FAILS CLOSED at the pre-network config guard
 * (getConfig throws ConfigError) — no network is ever reached.
 */
export function unconfiguredEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-test-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) {
    if (k.startsWith('NATIVEUI_')) delete env[k];
  }
  return { env, home };
}

/** Run a bin script with argv + opts. Returns { status, stdout, stderr }. */
export function runBin(name, argv = [], opts = {}) {
  const r = spawnSync('node', [bin(name), ...argv], {
    encoding: 'utf8',
    timeout: 20000,
    ...opts,
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  };
}

/** Run a bin script asynchronously. Use this when the test owns an in-process mock HTTP server. */
export function runBinAsync(name, argv = [], opts = {}) {
  return new Promise((resolve) => {
    const { input, timeout, ...spawnOpts } = opts;
    const child = spawn('node', [bin(name), ...argv], {
      ...spawnOpts,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeout || 20000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: null, signal: null, stdout, stderr, error });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Run any node script (absolute path) with argv. */
export function runNode(scriptPath, argv = [], opts = {}) {
  const r = spawnSync('node', [scriptPath, ...argv], {
    encoding: 'utf8',
    timeout: 20000,
    ...opts,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
