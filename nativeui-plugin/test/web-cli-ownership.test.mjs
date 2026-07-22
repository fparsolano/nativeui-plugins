import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EXPORT_MANIFEST_FILE,
  readExportManifest,
  resolveManifestTargetRoots,
  validateWebArtifacts,
  webArtifactLayout,
} from '../bin/export-manifest.mjs';
import { classifiedRootForExport, classifyProjectDir, runWeb } from '../bin/nui-run.mjs';
import { planFor, resolveReleaseRoots, webDeploymentInvocation } from '../bin/nui-release.mjs';
import { PLUGIN_DIR } from './helpers.mjs';

const targetContract = JSON.parse(
  fs.readFileSync(path.join(PLUGIN_DIR, 'capabilities', 'nativeui-targets.json'), 'utf8'),
);

function releaseOutputs(targetId, mode) {
  if (targetId === 'web-html') return ['index.html', 'manifest.webmanifest', 'sw.js', 'offline.html', 'assets/', 'icons/'];
  if (targetId === 'web-react') return mode === 'ssr' ? ['build/server/index.js', 'build/client/'] : ['build/client/'];
  if (targetId === 'web-vue') return mode === 'ssr' ? ['.output/server/index.mjs', '.output/public/'] : ['.output/public/'];
  if (targetId === 'web-angular') return mode === 'ssr' ? ['dist/*/server/server.mjs', 'dist/*/browser/'] : ['dist/*/browser/'];
  return mode === 'ssr' ? ['dist/server/entry.mjs', 'dist/client/'] : ['dist/'];
}

function modeMetadata(targetId, mode, generatedFiles, writeOnceFiles) {
  const vanilla = targetId === 'web-html';
  return {
    build: vanilla ? 'none' : `pnpm build:${mode}`,
    run: vanilla ? 'python3 -m http.server' : mode === 'ssr' ? 'pnpm start:ssr' : 'pnpm dev',
    release: vanilla ? 'deploy this directory to a static HTTPS host' : `deploy ${mode} output`,
    releaseOutputs: releaseOutputs(targetId, mode),
    toolchain: vanilla
      ? ['HTTP static host', 'modern browser']
      : mode === 'ssr'
        ? ['Node.js >=24.16.0 <25', 'pnpm 11.15.0', 'Node application host']
        : ['Node.js >=24.16.0 <25', 'pnpm 11.15.0'],
    generatedFiles,
    writeOnceFiles,
  };
}

function commands(targetId) {
  return targetId === 'web-html'
    ? { run: 'python3 -m http.server', release: 'deploy this directory to a static HTTPS host' }
    : {
        build: 'pnpm build:static',
        run: 'pnpm dev',
        test: 'pnpm typecheck && pnpm test',
        release: 'pnpm build:static',
        ssr: 'pnpm build:ssr && pnpm start:ssr',
      };
}

function toolchains(targetId) {
  return targetId === 'web-html'
    ? ['HTTP static host', 'modern browser']
    : ['Node.js >=24.16.0 <25', 'pnpm 11.15.0', 'modern browser'];
}

function writeFile(root, relative, contents = 'fixture\n') {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writeWebExport(root, targetId, {
  generated = ['README.md'],
  writeOnce = ['.gitignore'],
  createDeclaredFiles = true,
} = {}) {
  const modes = targetId === 'web-html' ? ['static'] : ['static', 'ssr'];
  const generatedFiles = [...generated, EXPORT_MANIFEST_FILE].sort();
  const writeOnceFiles = [...writeOnce].sort();
  const receipt = {
    id: 'html.element.button',
    receiptCategory: 'html.element.button',
    disposition: 'DIRECT',
    count: 1,
    implementation: 'native.web.html.element.button',
    loweringId: 'native.web.html.element.button',
    evidence: ['stage/home/node/cta carrier=direct:kind handler=button'],
  };
  const manifest = {
    schemaVersion: 2,
    targetIds: [targetId],
    generatedFiles,
    writeOnceFiles,
    capabilityContract: {
      schemaVersion: 2,
      manifestVersion: 'fixture',
      enforcementPhase: 'COMPLETE',
      capabilityCount: 1,
      kindCount: 1,
      triggerCount: 1,
      actionCount: 1,
      timelinePropertyCount: 1,
    },
    capabilityReport: {
      [targetId]: {
        sourceReport: 'web-export-report.txt',
        status: 'pass',
        receiptCategoryCount: 1,
        occurrenceCount: 1,
        capabilities: [receipt],
        kindContracts: [],
        triggerContracts: [],
        actionContracts: [],
        timelinePropertyContracts: [],
        occurrenceReceipts: [receipt],
        compilerSummaries: [],
      },
    },
    toolchains: { [targetId]: toolchains(targetId) },
    commands: { [targetId]: commands(targetId) },
    renderModes: { [targetId]: modes },
    targets: {
      [targetId]: {
        renderModes: modes,
        modes: Object.fromEntries(modes.map((mode) => [
          mode,
          modeMetadata(targetId, mode, generatedFiles, writeOnceFiles),
        ])),
        generatedFiles,
        writeOnceFiles,
      },
    },
  };
  fs.mkdirSync(root, { recursive: true });
  if (createDeclaredFiles) {
    for (const relative of [...generated, ...writeOnce]) writeFile(root, relative);
  }
  writeFile(root, EXPORT_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

test('authored web manifest validation requires exact capability projection metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-capability-manifest-'));
  try {
    const manifest = writeWebExport(root, 'web-react');
    delete manifest.capabilityContract.timelinePropertyCount;
    writeFile(root, EXPORT_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => readExportManifest(root), /timelinePropertyCount must be a positive integer/);

    manifest.capabilityContract.timelinePropertyCount = 1;
    manifest.capabilityReport['web-react'].occurrenceCount = 2;
    writeFile(root, EXPORT_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => readExportManifest(root), /occurrenceCount must equal the receipt occurrence sum/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('schema-2 authored web tooling and per-mode ownership metadata are required and exact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-mode-manifest-'));
  try {
    const baseline = writeWebExport(root, 'web-react');
    const cases = [
      ['top-level commands', (manifest) => { delete manifest.commands; }, /commands must be an object for web exports/],
      ['top-level toolchains', (manifest) => { delete manifest.toolchains; }, /toolchains must be an object for web exports/],
      ['lane command entry', (manifest) => { delete manifest.commands['web-react'].ssr; }, /commands\.web-react\.ssr must be a non-empty string/],
      ['lane toolchain entry', (manifest) => { manifest.toolchains['web-react'] = 'Node.js'; }, /toolchains\.web-react must be an array/],
      ['release outputs', (manifest) => { delete manifest.targets['web-react'].modes.static.releaseOutputs; }, /modes\.static\.releaseOutputs must be an array/],
      ['generated files', (manifest) => { delete manifest.targets['web-react'].modes.static.generatedFiles; }, /modes\.static\.generatedFiles must be an array/],
      ['write-once files', (manifest) => { delete manifest.targets['web-react'].modes.static.writeOnceFiles; }, /modes\.static\.writeOnceFiles must be an array/],
      ['exact generated files', (manifest) => { manifest.targets['web-react'].modes.static.generatedFiles = []; }, /modes\.static\.generatedFiles must match generatedFiles/],
      ['exact write-once files', (manifest) => { manifest.targets['web-react'].modes.static.writeOnceFiles = []; }, /modes\.static\.writeOnceFiles must match writeOnceFiles/],
      ['exact mode keys', (manifest) => { manifest.targets['web-react'].modes.preview = manifest.targets['web-react'].modes.static; }, /modes keys must exactly match renderModes\.web-react/],
    ];
    for (const [label, mutate, expected] of cases) {
      const candidate = JSON.parse(JSON.stringify(baseline));
      mutate(candidate);
      writeFile(root, EXPORT_MANIFEST_FILE, `${JSON.stringify(candidate, null, 2)}\n`);
      assert.throws(() => readExportManifest(root), expected, label);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('schema-2 manifests map every nested web-all lane to its own root', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-roots-'));
  const webTargets = targetContract.targets.filter((target) => target.platform === 'web');
  try {
    for (const target of webTargets) writeWebExport(path.join(parent, 'exports', target.id), target.id);
    const resolved = resolveManifestTargetRoots(parent, webTargets.map((target) => target.id));
    for (const target of webTargets) {
      assert.equal(resolved.roots.get(target.id), path.join(parent, 'exports', target.id));
    }

    const classified = await classifyProjectDir(parent);
    assert.equal(classified['web-html'], path.join(parent, 'exports', 'web-html'));
    assert.equal(classified['web-react'], path.join(parent, 'exports', 'web-react'));
    assert.deepEqual(
      classifiedRootForExport(classified, 'web', [webTargets.find((target) => target.id === 'web-html')]),
      { key: 'web-html', root: path.join(parent, 'exports', 'web-html') },
      'legacy --platform web still resolves the manifest-backed vanilla target',
    );

    const releaseRoots = resolveReleaseRoots({
      command: 'validate',
      project: parent,
      targets: webTargets,
    });
    for (const target of webTargets) assert.equal(releaseRoots.get(target.id), path.join(parent, 'exports', target.id));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('lane mismatches and schema-1 manifests are rejected instead of falling back to vanilla', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-mismatch-'));
  try {
    const html = path.join(parent, 'only-html');
    writeWebExport(html, 'web-html', { generated: ['index.html', 'manifest.webmanifest', 'sw.js'] });
    assert.throws(
      () => resolveManifestTargetRoots(parent, ['web-react']),
      /does not contain the requested lane.*web-react.*web-html/i,
    );
    const runResult = await runWeb(html, { launch: false, targetId: 'web-react', renderMode: 'static' });
    assert.equal(runResult.built, false);
    assert.match(runResult.note, /manifest declares \[web-html\], not web-react/);

    const old = path.join(parent, 'old');
    fs.mkdirSync(old);
    writeFile(old, EXPORT_MANIFEST_FILE, JSON.stringify({ schemaVersion: 1, targetIds: ['web-react'] }));
    assert.throws(() => readExportManifest(old), /schemaVersion must be 2/);

    const guessed = path.join(parent, 'generic-package');
    writeFile(guessed, 'package.json', '{}');
    writeFile(guessed, 'public/manifest.webmanifest');
    writeFile(guessed, 'index.html');
    const classified = await classifyProjectDir(guessed);
    assert.equal(classified.web, null);
    assert.equal(classified['web-html'], undefined);
    assert.equal(classified['web-react'], undefined);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('web artifact validation is lane- and mode-exact and exposes the static deploy directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-artifacts-'));
  try {
    writeFile(root, 'dist/index.html'); // A wrong-lane artifact must not satisfy React.
    let react = validateWebArtifacts(root, 'web-react', 'static');
    assert.equal(react.valid, false);
    assert.deepEqual(react.missing, [
      'build/client/index.html',
      'build/client/manifest.webmanifest',
      'build/client/sw.js',
    ]);
    for (const relative of react.requiredFiles) writeFile(root, relative);
    react = validateWebArtifacts(root, 'web-react', 'static');
    assert.equal(react.valid, true);
    assert.equal(react.staticOutputDir, path.join(root, 'build', 'client'));
    const reactTarget = targetContract.targets.find((target) => target.id === 'web-react');
    const staticPlan = planFor(reactTarget, root, { renderMode: 'static' });
    const deployment = webDeploymentInvocation(staticPlan, { project: root, provider: 'netlify' });
    assert.equal(deployment.staticRoot, path.join(root, 'build', 'client'));
    assert.deepEqual(deployment.args, ['deploy', '--prod', '--dir', path.join(root, 'build', 'client')]);
    const ssrPlan = planFor(reactTarget, root, { renderMode: 'ssr' });
    assert.throws(
      () => webDeploymentInvocation(ssrPlan, { project: root, provider: 'vercel' }),
      /SSR deployment is not automated.*Node application host/i,
    );

    writeFile(root, 'angular.json', JSON.stringify({
      projects: { authoredApp: { architect: { build: { options: { outputPath: 'dist/authored-app' } } } } },
    }));
    const angular = webArtifactLayout(root, 'web-angular', 'ssr');
    assert.deepEqual(angular.requiredFiles, [
      'dist/authored-app/server/server.mjs',
      'dist/authored-app/browser/manifest.webmanifest',
      'dist/authored-app/browser/ngsw-worker.js',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest declared-file validation catches missing generated and write-once files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-web-declared-files-'));
  try {
    writeWebExport(root, 'web-astro', {
      generated: ['src/pages/index.astro'],
      writeOnce: ['src/seams/app-actions.ts', '.gitignore'],
      createDeclaredFiles: false,
    });
    assert.throws(
      () => readExportManifest(root, { targetId: 'web-astro', requireDeclaredFiles: true }),
      /Declared file is missing: src\/pages\/index\.astro/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
