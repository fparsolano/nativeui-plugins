// test-gen.test.mjs — nui-test-gen.mjs importable helpers + end-to-end generation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseArgs,
  controlPropertyName,
  collectNamedNodes,
  deriveAccessors,
  iosTestSource,
  androidTestSource,
  KOTLIN_KEYWORDS,
  SWIFT_KEYWORDS,
} from '../bin/nui-test-gen.mjs';
import { runBin, fixture } from './helpers.mjs';

test('parseArgs: requires project + --out', () => {
  assert.throws(() => parseArgs([]), /Missing <project.json>/);
  assert.throws(() => parseArgs(['p.json', '--platform', 'ios']), /Missing --out/);
});

test('parseArgs: rejects a bad platform', () => {
  assert.throws(() => parseArgs(['p.json', '--platform', 'desktop', '--out', 'x']), /must be android\|ios\|both/);
});

test('controlPropertyName: matches the exporters (camelCase, digit/keyword safe, dedup)', () => {
  const used = new Set();
  assert.equal(controlPropertyName('banner_title', used, KOTLIN_KEYWORDS), 'bannerTitle');
  assert.equal(controlPropertyName('cat-art', used, KOTLIN_KEYWORDS), 'catArt');
  assert.equal(controlPropertyName('2col', used, KOTLIN_KEYWORDS), 'n2col');
  assert.equal(controlPropertyName('class', used, KOTLIN_KEYWORDS), 'classView');
  // digit-first -> "n" prefix on iOS too (Swift identifiers can't start with a digit)
  assert.equal(controlPropertyName('9lives', used, SWIFT_KEYWORDS), 'n9lives');
  // dedup: a second "screen" becomes "screen2"
  assert.equal(controlPropertyName('screen', used, KOTLIN_KEYWORDS), 'screen');
  assert.equal(controlPropertyName('screen', used, KOTLIN_KEYWORDS), 'screen2');
});

const PROJECT = {
  version: 4,
  stages: [
    {
      name: 'Home',
      rootNodes: [
        {
          kind: 'javafx.scene.layout.VBox',
          id: 'screen',
          children: [
            { kind: 'javafx.scene.control.Label', id: 'banner_title' },
            { kind: 'javafx.scene.control.Button', id: '1digit' }, // digit-first
            { kind: 'javafx.scene.control.TextField', id: 'email_field' },
          ],
        },
      ],
    },
  ],
};

test('collectNamedNodes: gathers ids + letter-first flag', () => {
  const named = collectNamedNodes(PROJECT);
  assert.deepEqual(
    named.map((n) => [n.id, n.letterFirst]),
    [['screen', true], ['banner_title', true], ['1digit', false], ['email_field', true]]
  );
});

test('deriveAccessors: Android excludes digit-first ids (no typed accessor)', () => {
  const named = collectNamedNodes(PROJECT);
  const android = deriveAccessors(named, KOTLIN_KEYWORDS, 'android'); // letter-first only
  assert.ok(!android.find((r) => r.id === '1digit'), 'digit-first id must have no Android accessor');
  assert.ok(android.find((r) => r.id === 'screen' && r.prop === 'screen'));
});

test('deriveAccessors: iOS surfaces every named node (digit-first -> n-prefixed)', () => {
  const named = collectNamedNodes(PROJECT);
  const ios = deriveAccessors(named, SWIFT_KEYWORDS, 'ios');
  const digit = ios.find((r) => r.id === '1digit');
  assert.ok(digit, 'iOS surfaces digit-first ids');
  assert.equal(digit.prop, 'n1digit');
});

test('iosTestSource: asserts a typed accessor for a letter-first node + the untyped fallback', () => {
  const named = collectNamedNodes(PROJECT);
  const src = iosTestSource(PROJECT, named);
  assert.match(src, /@testable import App/);
  assert.match(src, /XCTAssertNotNil\(controls\.screen/); // representative letter-first id
  assert.match(src, /controls\.view\("screen"\)/);
  assert.match(src, /func testSmoke_screenBuildsWithoutThrowing/);
  assert.match(src, /NuiBackend\.shared/);
});

test('androidTestSource: Robolectric + asserts typed accessor + view(id)', () => {
  const named = collectNamedNodes(PROJECT);
  const src = androidTestSource('com.example.generatedapp', PROJECT, named);
  assert.match(src, /RobolectricTestRunner/);
  assert.match(src, /NuiScreenControls\(activity\)/);
  assert.match(src, /controls\.screen/);
  assert.match(src, /controls\.view\("screen"\)/);
  assert.match(src, /ActivityScenario\.launch\(MainActivity::class\.java\)/);
});

test('end-to-end: generates files into both platform dirs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-testgen-'));
  const androidOut = path.join(tmp, 'android');
  const iosOut = path.join(tmp, 'ios');
  const r = runBin('nui-test-gen.mjs', [
    fixture('good-project.json'),
    '--platform', 'both',
    '--out', androidOut,
    '--ios-out', iosOut,
  ]);
  assert.equal(r.status, 0, r.stderr);
  // Android unit + instrumented tests written under the package path.
  const unit = path.join(androidOut, 'app', 'src', 'test', 'kotlin', 'com', 'nui', 'app', 'NuiBackendContractTest.kt');
  const inst = path.join(androidOut, 'app', 'src', 'androidTest', 'kotlin', 'com', 'nui', 'app', 'NuiBackendContractInstrumentedTest.kt');
  assert.ok(fs.existsSync(unit), 'android unit test written');
  assert.ok(fs.existsSync(inst), 'android instrumented test written');
  // iOS XCTest + README written.
  const swift = path.join(iosOut, 'Tests', 'NuiBackendContractTests.swift');
  assert.ok(fs.existsSync(swift), 'ios XCTest written');
  assert.ok(fs.existsSync(path.join(iosOut, 'Tests', 'README.md')), 'ios Tests README written');
  // Content sanity: the good-project's first letter-first id is "screen".
  assert.match(fs.readFileSync(swift, 'utf8'), /controls\.screen/);
});

test('fail-closed: missing project file -> exit 1', () => {
  const r = runBin('nui-test-gen.mjs', ['/no/such.json', '--platform', 'ios', '--out', '/tmp/x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found/);
});

test('fail-closed: a non-project JSON (no stages) -> exit 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-testgen-'));
  const bad = path.join(tmp, 'x.json');
  fs.writeFileSync(bad, '{"hello":1}');
  const r = runBin('nui-test-gen.mjs', [bad, '--platform', 'ios', '--out', tmp]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no stages/);
});
