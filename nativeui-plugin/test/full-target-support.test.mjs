import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_DIR, runBin } from './helpers.mjs';

const targets = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'capabilities', 'nativeui-targets.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'capabilities', 'nativeui-capability-catalog.json'), 'utf8'));

test('authoritative capability catalog maps every declaration to every target without unknowns', () => {
  assert.equal(targets.targets.length, 16);
  assert.equal(catalog.capabilities.length, catalog.counts.capabilities);
  assert.ok(catalog.capabilities.length >= 239);
  const targetIds = targets.targets.map((target) => target.id).sort();
  const declarations = [catalog.capabilities, catalog.kindContracts, catalog.transportMarkers,
    catalog.triggerContracts, catalog.actionContracts, catalog.timelinePropertyContracts].flat();
  for (const capability of declarations) {
    assert.deepEqual(Object.keys(capability.targetSupport).sort(), targetIds, capability.id);
    for (const support of Object.values(capability.targetSupport)) {
      assert.ok(['IMPLEMENTED', 'COMPILED_AWAY', 'GATED'].includes(support.disposition), capability.id);
    }
  }
});

test('target contract publishes responsive defaults and honest platform delivery profiles', () => {
  assert.equal(targets.authoringDefaults.responsive, true);
  assert.equal(targets.authoringDefaults.flowMode, 'dynamic');
  assert.equal(targets.authoringDefaults.constraintModel, 'parent-owned');
  assert.equal(targets.authoringDefaults.fixedCanvasAllowed, false);

  assert.deepEqual(targets.groups['mobile-flagship'], ['ios-swiftui', 'android-compose']);
  assert.deepEqual(targets.groups['mobile-rust'], ['rust-ios', 'rust-android']);
  assert.deepEqual(targets.groups['mobile-csharp'], ['csharp-ios', 'csharp-android']);
  assert.deepEqual(targets.groups.desktop, ['rust-desktop']);
  assert.deepEqual(targets.groups['desktop-rust'], ['rust-desktop']);
  assert.deepEqual(targets.groups['desktop-csharp'], ['csharp-desktop']);
  assert.deepEqual(targets.groups['desktop-all'], ['rust-desktop', 'csharp-desktop']);

  assert.deepEqual(targets.deliveryProfiles.mobile.defaultSelection.targetIds, ['ios-swiftui', 'android-compose']);
  assert.equal(targets.deliveryProfiles.web.defaultSelection.targetIds[0], 'web-html');
  assert.equal(targets.deliveryProfiles.web.defaultSelection.renderMode, 'static');
  assert.equal(targets.deliveryProfiles.desktop.defaultSelection.targetIds[0], 'rust-desktop');
  assert.match(targets.deliveryProfiles.desktop.unavailableChoices[0].description, /does not currently provide this target/);
  assert.equal(targets.deliveryProfiles.desktop.unavailableChoices[0].presentByDefault, true);
  assert.equal(targets.targets.some((target) => target.id === 'macos-swiftui'), false);

  for (const target of targets.targets) {
    assert.ok(target.description, `${target.id} description`);
    assert.ok(target.bestFor, `${target.id} bestFor`);
    assert.ok(target.tradeoffs, `${target.id} tradeoffs`);
  }
  for (const target of targets.targets.filter((candidate) => candidate.platform === 'web')) {
    assert.ok(target.renderModes.includes(target.defaultRenderMode), `${target.id} default render mode`);
  }

  assert.deepEqual(catalog.defaultTargets, targets.defaultTargets);
  assert.deepEqual(catalog.groups, targets.groups);
  assert.deepEqual(catalog.authoringDefaults, targets.authoringDefaults);
  assert.deepEqual(catalog.deliveryProfiles, targets.deliveryProfiles);
});

test('nui-capabilities exposes matrix, search, and target detail', () => {
  const matrix = runBin('nui-capabilities.mjs', ['matrix', '--json']);
  assert.equal(matrix.status, 0, matrix.stderr);
  const matrixRows = JSON.parse(matrix.stdout);
  assert.equal(matrixRows.length, 16);
  const html = matrixRows.find((target) => target.id === 'web-html');
  assert.match(html.description, /semantic HTML/);
  assert.match(html.tradeoffs, /Static build\/hosting only but fully client-interactive/i);
  assert.deepEqual(html.renderModes, ['static']);
  assert.equal(html.defaultRenderMode, 'static');
  const react = matrixRows.find((target) => target.id === 'web-react');
  assert.deepEqual(react.renderModes, ['static', 'ssr']);
  assert.equal(react.defaultRenderMode, 'static');

  const search = runBin('nui-capabilities.mjs', ['search', 'navigate', '--target', 'web-html', '--json']);
  assert.equal(search.status, 0, search.stderr);
  assert.ok(JSON.parse(search.stdout).length > 0);

  const show = runBin('nui-capabilities.mjs', ['show', 'csharp-ios', '--json']);
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).writeOnceFiles[0], 'AppActions.cs');
});

test('editor resume decision is conservative', async () => {
  const { decideResume } = await import('../bin/nui-editor.mjs');
  assert.equal(decideResume({ conflict: true }), 'conflict');
  assert.equal(decideResume({ inSync: true }), 'in-sync');
  assert.equal(decideResume({ cloudChanged: true, localChanged: false }), 'pull');
  assert.equal(decideResume({ cloudChanged: false, localChanged: true }), 'local-only');
});

test('screen replacement preserves stage identity, board position, and existing interactions', async () => {
  const { mergeStage, mergeLibraryItems } = await import('../bin/nui-screen-update.mjs');
  const existing = {
    stageId: 'stage-home', name: 'Home', boardX: 42, boardY: 9,
    interactions: [{ id: 'keep', action: 'NAVIGATE_TO_STAGE' }], rootNodes: [{ id: 'old' }],
    interactionSpecs: [{ trigger: 'ON_LOAD', action: 'SET_STATE', target: 'ready' }],
  };
  const imported = {
    stageId: 'temporary', name: 'Imported', boardX: 0,
    interactions: [{ id: 'new', action: 'CALL_API' }], rootNodes: [{ id: 'new' }],
    interactionSpecs: [{ trigger: 'ON_TAP', action: 'NAVIGATE_TO_STAGE', targetStageId: 'details' }],
  };
  const merged = mergeStage(existing, imported);
  assert.equal(merged.stageId, 'stage-home');
  assert.equal(merged.name, 'Home');
  assert.equal(merged.boardX, 42);
  assert.deepEqual(merged.interactions.map((item) => item.id), ['keep', 'new']);
  assert.deepEqual(merged.interactionSpecs.map((item) => item.trigger), ['ON_LOAD', 'ON_TAP']);

  const project = { libraryItems: [{ id: 'api', kind: 'api', config: { path: '/old' } }] };
  const stage = { interactions: [{ targetLibraryItemId: 'api' }] };
  const importedItems = [
    { id: 'form', kind: 'form', config: { submitTo: 'api' } },
    { id: 'api', kind: 'api', config: { path: '/new' } },
  ];
  const library = mergeLibraryItems(project, importedItems, stage, false);
  assert.equal(library.remapped.length, 1);
  assert.notEqual(stage.interactions[0].targetLibraryItemId, 'api');
  assert.equal(library.libraryItems.find((item) => item.id === 'form').config.submitTo, library.remapped[0].to);
});

test('doctor supports target groups and release commands gate external state', () => {
  const doctor = runBin('nui-doctor.mjs', ['--target', 'web', '--json', '--no-fail']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).targets[0].targetId, 'web-html');

  const plan = runBin('nui-release.mjs', ['plan', '--project', PLUGIN_DIR, '--target', 'all', '--json']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).reports.length, 16);

  const deploy = runBin('nui-release.mjs', ['deploy', '--project', PLUGIN_DIR, '--target', 'web-html']);
  assert.equal(deploy.status, 1);
  assert.match(deploy.stderr, /--confirm-external/);
});

test('SSR release validation recognizes each framework-native server artifact', async () => {
  const { planFor, validate } = await import('../bin/nui-release.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nativeui-web-ssr-artifacts-'));
  try {
    for (const targetId of ['web-react', 'web-vue', 'web-angular', 'web-astro']) {
      const project = path.join(root, targetId);
      if (targetId === 'web-angular') {
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, 'angular.json'), JSON.stringify({
          projects: { example: { architect: { build: { options: { outputPath: 'dist/example' } } } } },
        }));
      }
      const target = targets.targets.find((candidate) => candidate.id === targetId);
      const plan = planFor(target, project, { renderMode: 'ssr' });
      for (const relative of plan.artifacts) {
        fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
        fs.writeFileSync(path.join(project, relative), '// release artifact\n');
      }
      assert.equal(validate(plan, project, '').valid, true, targetId);
      assert.deepEqual(plan.deploy, [], targetId);
      assert.equal(plan.deployment.automated, false, targetId);
      assert.deepEqual(plan.deployment.supportedProviders, [], targetId);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('run, test generation, and final review share the same target selectors', async () => {
  const run = await import('../bin/nui-run.mjs');
  const testGen = await import('../bin/nui-test-gen.mjs');
  const review = await import('../bin/nui-final-review.mjs');
  const { resolveTargets } = await import('../bin/target-contract.mjs');

  assert.deepEqual(resolveTargets(['mobile-flagship']).map((target) => target.id), ['ios-swiftui', 'android-compose']);
  assert.deepEqual(resolveTargets(['mobile-rust']).map((target) => target.id), ['rust-ios', 'rust-android']);
  assert.deepEqual(resolveTargets(['mobile-csharp']).map((target) => target.id), ['csharp-ios', 'csharp-android']);
  assert.deepEqual(resolveTargets(['desktop']).map((target) => target.id), ['rust-desktop']);
  assert.deepEqual(resolveTargets(['desktop-all']).map((target) => target.id), ['rust-desktop', 'csharp-desktop']);

  const runArgs = run.parseArgs([
    'project.json', '--target', 'rust-web', '--target', 'web-html', '--target', 'csharp-ios',
  ]);
  assert.deepEqual(runArgs.selectedTargets.map((target) => target.id), ['rust-web', 'web-html', 'csharp-ios']);
  assert.throws(
    () => run.parseArgs(['project.json', '-p', 'rust', '--target', 'rust-web']),
    /either --target\/--all-targets or the legacy --platform/,
  );

  const testArgs = testGen.parseArgs([
    'project.json', '--target', 'auto', '--target', 'csharp', '--target', 'web', '--out', 'out',
  ]);
  assert.deepEqual(testArgs.selectedTargets.map((target) => target.id), [
    'ios-swiftui', 'android-compose', 'csharp-desktop', 'csharp-ios', 'csharp-android', 'web-html',
  ]);

  const reviewArgs = review.parseArgs([
    '--project', 'project.json', '--target', 'rust', '--target-dir', 'rust-web=out/rust',
  ]);
  assert.deepEqual(reviewArgs.selectedTargets.map((target) => target.id), [
    'rust-desktop', 'rust-ios', 'rust-android', 'rust-web',
  ]);
  assert.equal(reviewArgs.targetDirs['rust-web'], 'out/rust');
});
