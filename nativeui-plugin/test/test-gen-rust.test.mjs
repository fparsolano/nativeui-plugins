// test-gen-rust.test.mjs — nui-test-gen's Rust target group: parseArgs must accept `rust`, and the
// generated cargo-test source must assert the real NuiBackend contract surface. (The generated source is
// additionally proven to COMPILE + PASS against the real nui_rt crate in the campaign's e2e check.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseArgs, rustTestSource } = await import(
  pathToFileURL(path.join(here, '..', 'bin', 'nui-test-gen.mjs')).href
);

test('parseArgs accepts --platform rust with --out', () => {
  const r = parseArgs(['project.json', '--platform', 'rust', '--out', './rust-out']);
  assert.equal(r.platform, 'rust');
  assert.equal(r.out, './rust-out');
});

test('parseArgs rejects an unknown platform, listing rust and web', () => {
  assert.throws(
    () => parseArgs(['project.json', '--platform', 'wat', '--out', 'x']),
    /--platform must be android\|ios\|both\|rust\|web/,
  );
});

test('rustTestSource asserts the full 11-hook NuiBackend contract surface', () => {
  const src = rustTestSource({ stages: [{ stageId: 's1' }] });
  // Uses the real public API paths.
  assert.match(src, /use nui_rt::actions::\{NoopBackend, NuiBackend, NuiScreenControls\}/);
  assert.match(src, /use nui_rt::scene::Stage/);
  assert.match(src, /impl NuiBackend for RecordingBackend/);
  // Every one of the 11 hooks is implemented in the test double.
  for (const hook of [
    'on_screen_ready',
    'on_navigate_to_stage',
    'on_call_api',
    'on_call_database',
    'on_play_timeline',
    'on_open_url',
    'on_submit_form',
    'on_set_state',
    'on_run_script',
    'on_animate_panel',
    'fetch_list',
  ]) {
    assert.match(src, new RegExp(`fn ${hook}\\b`), `missing hook ${hook}`);
  }
  // The three contract assertions.
  assert.match(src, /every hook dispatched exactly once/);
  assert.match(src, /noop_backend_satisfies_the_trait/);
  assert.match(src, /missing.*id is a silent None|silent None/i);
  // The honest compile-enforcement disclosure (AppActions:NuiBackend guaranteed by main.rs).
  assert.match(src, /COMPILATION already guarantees/);
  assert.match(src, /run_multi_stage_app/);
});

test('rustTestSource notes the project stage count', () => {
  const src = rustTestSource({ stages: [{}, {}, {}] });
  assert.match(src, /Project stages: 3/);
});
