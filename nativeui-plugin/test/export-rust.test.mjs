// export-rust.test.mjs — the legacy `--platform rust` alias: the CLI must POST to
// /export/rust, name the artifact rust-export.zip, unzip the single Cargo project, and support
// the shared per-file manifest route.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fixture, runBinAsync } from './helpers.mjs';

// A minimal valid ZIP of a Cargo project skeleton so the CLI's post-download unzip step succeeds.
function buildRustZipBytes() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-zip-src-'));
  fs.writeFileSync(path.join(src, 'Cargo.toml'), '[package]\nname = "app"\n');
  fs.mkdirSync(path.join(src, 'src', 'screens'), { recursive: true });
  fs.writeFileSync(path.join(src, 'src', 'app_actions.rs'), '// dev seam\n');
  fs.writeFileSync(path.join(src, 'src', 'screens', 'stage_0.rs'), '// generated screen\n');
  const zip = path.join(os.tmpdir(), `rust-export-${path.basename(src)}.zip`);
  let r = spawnSync('zip', ['-r', '-q', zip, '.'], { cwd: src });
  if (r.error?.code === 'ENOENT') {
    r = spawnSync('tar', ['-a', '-c', '-f', zip, '.'], { cwd: src });
  }
  assert.equal(r.status, 0, r.stderr?.toString() || 'zip or tar archive tool available');
  const bytes = fs.readFileSync(zip);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  return bytes;
}

// Export-only env: no creds, no billing — the config guard passes and no auth header is required.
function rustEnv(baseUrl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-rust-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (k.startsWith('NATIVEUI_')) delete env[k];
  env.NATIVEUI_EXPORT_SERVICE_URL = baseUrl;
  env.NATIVEUI_EXPORT_AUTH_MODE = 'none';
  env.NATIVEUI_BILLING_API_URL = '';
  return env;
}

async function withServer(handler, fn) {
  const calls = [];
  const server = http.createServer((req, res) => handler(req, res, calls));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('nui-export --platform rust POSTs /export/rust and unzips rust-export.zip', async () => {
  const zipBytes = buildRustZipBytes();
  await withServer(
    (req, res, calls) => {
      calls.push({ url: req.url, method: req.method });
      res.setHeader('Content-Type', 'application/zip');
      res.end(zipBytes);
    },
    async (baseUrl, calls) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-rust-out-'));
      const r = await runBinAsync(
        'nui-export.mjs',
        [fixture('good-project.json'), '--platform', 'rust', '-o', outDir],
        { env: rustEnv(baseUrl) },
      );
      assert.equal(r.status, 0, r.stderr);
      // Routed to the Rust endpoint (default clean/prod mode), not android/ios.
      assert.equal(calls.at(-1).method, 'POST');
      assert.equal(calls.at(-1).url, '/export/rust?mode=prod');
      // Artifact named for the platform, and the single Cargo project was unzipped in place.
      assert.ok(fs.existsSync(path.join(outDir, 'rust-export.zip')), 'rust-export.zip written');
      assert.ok(fs.existsSync(path.join(outDir, 'Cargo.toml')), 'Cargo.toml unzipped');
      assert.ok(
        fs.existsSync(path.join(outDir, 'src', 'app_actions.rs')),
        'src/app_actions.rs (the write-once dev seam) unzipped',
      );
      fs.rmSync(outDir, { recursive: true, force: true });
    },
  );
});

test('nui-export --platform rust --manifest POSTs /export/rust/manifest', async () => {
  await withServer(
    (req, res, calls) => {
      calls.push({ url: req.url, method: req.method });
      res.setHeader('Content-Type', 'application/json');
      res.end('{"files":[{"path":"nativeui-export-manifest.json"}]}');
    },
    async (baseUrl, calls) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-rust-out-'));
      const r = await runBinAsync(
        'nui-export.mjs',
        [fixture('good-project.json'), '--platform', 'rust', '--manifest', '-o', outDir],
        { env: rustEnv(baseUrl) },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(calls.at(-1).url, '/export/rust/manifest?mode=prod');
      assert.ok(fs.existsSync(path.join(outDir, 'rust-export-manifest.json')));
      fs.rmSync(outDir, { recursive: true, force: true });
    },
  );
});
