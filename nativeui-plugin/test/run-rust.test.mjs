// run-rust.test.mjs — the legacy `--platform rust` run path: parseArgs must accept rust
// + --rust-target, classifyProjectDir must recognize a Cargo.toml root, and cargo resolution must
// prefer the rustup toolchain without throwing. (runRust itself shells cargo and is exercised e2e.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseArgs, classifyProjectDir, resolveCargo } = await import(
  pathToFileURL(path.join(here, '..', 'bin', 'nui-run.mjs')).href
);

test('parseArgs accepts --platform rust and defaults --rust-target to host', () => {
  const r = parseArgs(['proj.json', '--platform', 'rust']);
  assert.equal(r.platform, 'rust');
  assert.equal(r.rustTarget, 'host');
});

test('parseArgs accepts --rust-target ios-sim with --platform rust', () => {
  const r = parseArgs(['proj.json', '--platform', 'rust', '--rust-target', 'ios-sim']);
  assert.equal(r.platform, 'rust');
  assert.equal(r.rustTarget, 'ios-sim');
});

test('parseArgs accepts --rust-target web with --platform rust', () => {
  const r = parseArgs(['proj.json', '--platform', 'rust', '--rust-target', 'web']);
  assert.equal(r.platform, 'rust');
  assert.equal(r.rustTarget, 'web');
});

test('parseArgs accepts --rust-target android with --platform rust', () => {
  const r = parseArgs(['proj.json', '--platform', 'rust', '--rust-target', 'android']);
  assert.equal(r.platform, 'rust');
  assert.equal(r.rustTarget, 'android');
});

test('parseArgs leaves rustTarget undefined for the mobile platforms', () => {
  const r = parseArgs(['proj.json', '--platform', 'android']);
  assert.equal(r.platform, 'android');
  assert.equal(r.rustTarget, undefined);
});

test('parseArgs rejects --rust-target for a non-rust platform', () => {
  assert.throws(
    () => parseArgs(['proj.json', '--platform', 'ios', '--rust-target', 'ios-sim']),
    /--rust-target only applies to --platform rust/,
  );
});

test('parseArgs rejects an unknown --rust-target value', () => {
  assert.throws(
    () => parseArgs(['proj.json', '--platform', 'rust', '--rust-target', 'wat']),
    /--rust-target must be host\|ios-sim/,
  );
});

test('parseArgs accepts legacy --platform web and defaults to static rendering', () => {
  const r = parseArgs(['proj.json', '--platform', 'web']);
  assert.equal(r.platform, 'web');
  assert.equal(r.renderMode, 'static');
});

test('help advertises the legacy web alias and web render modes', () => {
  assert.throws(
    () => parseArgs(['--help']),
    (error) => {
      assert.match(error.message, /--platform android\|ios\|both\|rust\|web/);
      assert.match(error.message, /--platform web\s+legacy alias for the authored vanilla web-html PWA/);
      assert.match(error.message, /--render-mode static\|ssr/);
      return true;
    },
  );
});

test('classifyProjectDir recognizes a Cargo.toml + src/ root as rust', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-classify-rust-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "app"\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'main.rs'), 'fn main() {}\n');
  const found = await classifyProjectDir(dir);
  assert.ok(found.rust, 'rust root detected');
  assert.ok(fs.existsSync(path.join(found.rust, 'Cargo.toml')), 'points at the Cargo project');
  assert.equal(found.android, null);
  assert.equal(found.ios, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('classifyProjectDir does not mistake an Android tree for rust', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-classify-android-'));
  fs.writeFileSync(path.join(dir, 'settings.gradle.kts'), 'rootProject.name = "app"\n');
  const found = await classifyProjectDir(dir);
  assert.ok(found.android, 'android root detected');
  assert.equal(found.rust, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveCargo returns a usable path or null (never throws)', () => {
  const cargo = resolveCargo();
  assert.ok(cargo === null || (typeof cargo === 'string' && cargo.length > 0));
});
