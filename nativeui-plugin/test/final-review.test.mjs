// final-review.test.mjs - the final reviewer catches invalid import surface,
// missing responsiveness, no-runtime events, and backend logic in NuiBackend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nui-review-'));
}

function responsiveHtml(body, extraCss = '') {
  return `<!doctype html><html><head><style>
body{margin:0;width:100%;min-width:0;min-height:100vh}
.screen{display:grid;width:100%;min-width:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}
.content{flex:1;min-width:0}
${extraCss}
</style></head><body><main class="screen"><section class="content">${body}</section></main></body></html>`;
}

function writeProject(file, extra = {}) {
  fs.writeFileSync(file, JSON.stringify({
    version: 4,
    libraryItems: extra.libraryItems || [],
    stages: [
      {
        name: 'Login',
        responsiveLayoutVersion: 1,
        divisions: [],
        rootNodes: [
          {
            kind: 'javafx.scene.layout.VBox',
            id: 'login_screen',
            semanticWidth: 'fill',
            parentLayoutProps: { 'nui.semanticWidth': '100%', 'anchor.left': '0', 'anchor.right': '0' },
            children: [
              {
                kind: 'javafx.scene.control.Button', id: 'login_button', text: 'Log in',
                interactions: [{ trigger: 'CLICK', action: 'SET_STATE', targetNodeId: 'login_screen', params: { state: 'selected' } }],
              },
              { kind: 'javafx.scene.control.Label', id: 'loading_state', text: 'Loading' },
              { kind: 'javafx.scene.control.Label', id: 'empty_state', text: 'Empty' },
              { kind: 'javafx.scene.control.Label', id: 'error_state', text: 'Error' },
              { kind: 'javafx.scene.control.Label', id: 'success_state', text: 'Success' },
            ],
            ...(extra.node || {}),
          },
        ],
        ...(extra.stage || {}),
      },
    ],
  }, null, 2));
}

function writeArchitecture(file, approved = true) {
  fs.writeFileSync(file, `# NativeUI Architecture

## Audit Summary
- Existing app reviewed.

## Selected Delivery Targets
- Target IDs: ios-swiftui, android-compose

## Recommended Stack
- Stack: Node/Hono.

## Alternatives
- Python/FastAPI.

## Local Run Plan
- Command: npm run dev

## Client Delivery And Hosting
- API origin: https://api.example.test
- Authentication/session model: bearer token

## Deployment Plan
- Target: Cloud Run

## Repository Layout
- Backend path: backend/

## API Database Auth Contract
- Routes: POST /api/login

## Secret Policy
- Secrets live in env/deploy secret store only.

## NativeUI Wiring Plan
- Android and iOS connectors mirror behavior.

## Implementation Phases
- Phase 1: scaffold

## Approval
- [${approved ? 'x' : ' '}] User approved this architecture for implementation.
`);
}

function writeHtmlExport(root, { missing = '', schemaVersion = 2 } = {}) {
  const generatedFiles = [
    'README.md',
    'index.html',
    'manifest.webmanifest',
    'nativeui-export-manifest.json',
    'sw.js',
  ];
  const writeOnceFiles = ['.gitignore', 'app-actions.js', 'custom-components.js', 'data-adapters.js'];
  const mode = {
    build: 'none',
    run: 'python3 -m http.server',
    release: 'deploy this directory',
    releaseOutputs: ['index.html', 'manifest.webmanifest', 'sw.js'],
    toolchain: ['HTTP static host', 'modern browser'],
    generatedFiles,
    writeOnceFiles,
  };
  const receipt = {
    id: 'html.element.button',
    receiptCategory: 'html.element.button',
    disposition: 'DIRECT',
    count: 1,
    implementation: 'native.web.html.element.button',
    loweringId: 'native.web.html.element.button',
    evidence: ['stage/login/node/login_button carrier=direct:kind handler=button'],
  };
  const manifest = {
    schemaVersion,
    targetIds: ['web-html'],
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
      'web-html': {
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
    toolchains: { 'web-html': ['HTTP static host', 'modern browser'] },
    commands: {
      'web-html': {
        run: 'python3 -m http.server',
        release: 'deploy this directory',
      },
    },
    renderModes: { 'web-html': ['static'] },
    targets: {
      'web-html': {
        renderModes: ['static'],
        modes: { static: mode },
        generatedFiles,
        writeOnceFiles,
      },
    },
  };
  fs.mkdirSync(root, { recursive: true });
  for (const relative of [...generatedFiles, ...writeOnceFiles]) {
    if (relative === 'nativeui-export-manifest.json' || relative === missing) continue;
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relative === 'index.html' ? '<main>Authored web app</main>' : 'fixture\n');
  }
  fs.writeFileSync(path.join(root, 'nativeui-export-manifest.json'), JSON.stringify(manifest, null, 2));
}

test('passes a responsive project/html with no backend events', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project);
  fs.writeFileSync(html, responsiveHtml('<a class="cta" href="#home">Continue</a>', '.cta:focus{opacity:.8}'));
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--html', html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.flow.ok, true);
});

test('fails a responsive project that has no dynamic user flow', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project, { node: { interactions: [], children: [{ kind: 'javafx.scene.control.Label', id: 'headline', text: 'Overview' }] } });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((finding) => finding.code === 'flow.interactions-missing'));
});

test('allows supported radial gradients and warns on conic gradients only', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project);
  fs.writeFileSync(html, responsiveHtml('<a href="#home">Continue</a>', '.screen{background:radial-gradient(circle,#fff,#ddd)}.content{background:conic-gradient(red,blue)}'));
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--html', html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  const gradientFindings = report.findings.filter((f) => f.code === 'css.gradient-unsupported');
  assert.equal(gradientFindings.length, 1);
  assert.match(gradientFindings[0].message, /Conic\/repeating/);
});

test('reports repeater preview and datasource coverage gaps', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const architecture = path.join(dir, 'nativeui-architecture.md');
  writeArchitecture(architecture, true);
  writeProject(project, {
    node: {
      repeater: {
        enabled: true,
        dataSource: 'api.results',
        itemName: 'item',
        previewCount: 3,
      },
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--architecture', architecture], { env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.project.repeaterCount, 1);
  assert.equal(report.project.dataRepeaterCount, 1);
  assert.ok(report.findings.find((f) => f.code === 'repeater.sample-items-missing'));
  assert.ok(report.findings.find((f) => f.code === 'repeater.datasource-unregistered'));
});

test('fails live data instructions when repeater datasource is unregistered', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project, {
    node: {
      repeater: {
        enabled: true,
        dataSource: 'api.results',
        itemName: 'item',
        previewCount: 3,
        sampleItems: [{ title: 'Preview row' }],
      },
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', [
    '--project',
    project,
    '--instructions',
    'Build a live data-backed results list from an API.',
  ], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'repeater.datasource-live-unregistered'));
});

test('fails on fixed-canvas interaction-free HTML and security-gated script events', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'RUN_SCRIPT', params: { handler: 'save()' } }],
    },
  });
  fs.writeFileSync(html, '<script>save()</script><style>.screen{width:417px}.hero{background:url("https://example.com/a.png")}</style><main class="screen"></main>');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--html', html], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'html.script'));
  assert.ok(report.findings.find((f) => f.code === 'asset.remote-image'));
  assert.ok(report.findings.find((f) => f.code === 'responsive.html-missing'));
  assert.ok(report.findings.find((f) => f.code === 'event.action-gated'));
});

test('fails when backend-required events exist but exported dirs contain no connectors', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const android = path.join(dir, 'android-out');
  fs.mkdirSync(path.join(android, 'app/src/main/kotlin/com/example'), { recursive: true });
  fs.writeFileSync(path.join(android, 'app/src/main/kotlin/com/example/NuiBackend.kt'), 'object NuiBackend : NuiScreenDelegate { fun load() { HttpURLConnection.setFollowRedirects(true) } }');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--android-dir', android], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'backend.connectors-missing'));
  assert.ok(report.findings.find((f) => f.code === 'backend.logic-in-delegator'));
});

test('fails backend-required functionality without approved architecture', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project, {
    libraryItems: [{ id: 'lib-api-login', name: 'Login', assetType: 'api', configJson: '{"path":"/login"}' }],
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'architecture.missing'));
});

test('passes backend-required functionality with approved architecture and matching connectors', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const architecture = path.join(dir, 'nativeui-architecture.md');
  const android = path.join(dir, 'android-out/app/src/main/kotlin/com/example');
  const ios = path.join(dir, 'ios-out/App');
  fs.mkdirSync(android, { recursive: true });
  fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(android, 'LoginBackendConnector.kt'), 'class LoginBackendConnector');
  fs.writeFileSync(path.join(ios, 'LoginBackendConnector.swift'), 'final class LoginBackendConnector {}');
  writeArchitecture(architecture, true);
  writeProject(project, {
    libraryItems: [{ id: 'lib-api-login', name: 'Login', assetType: 'api', configJson: '{"path":"/login"}' }],
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', [
    '--project',
    project,
    '--architecture',
    architecture,
    '--android-dir',
    path.join(dir, 'android-out'),
    '--ios-dir',
    path.join(dir, 'ios-out'),
  ], { env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.architecture.approved, true);
});

test('an approval checkbox cannot hide unresolved web delivery and hosting decisions', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const architecture = path.join(dir, 'nativeui-architecture.md');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  writeArchitecture(architecture, true);
  const unresolvedWeb = fs.readFileSync(architecture, 'utf8')
    .replace('- Target IDs: ios-swiftui, android-compose', '- Target IDs: web-react');
  fs.writeFileSync(architecture, unresolvedWeb);

  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', [
    '--project', project,
    '--architecture', architecture,
  ], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  const finding = report.findings.find((item) => item.code === 'architecture.decisions-unresolved');
  assert.ok(finding);
  assert.match(finding.detail.unresolvedDecisions.join(' '), /render mode|hosting|direct-route|base-path/i);
});

test('does not require architecture for connector-only timeline behavior', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'PLAY_TIMELINE', targetTimelineId: 'intro' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project], { env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.architecture, null);
  assert.ok(report.findings.find((f) => f.code === 'event.connector-required'));
  assert.ok(!report.findings.find((f) => f.code === 'architecture.missing'));
});

test('fails when CALL_API does not target an api library item', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'missing-api' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'library.api-missing'));
});

test('fails when Android and iOS connector class sets diverge', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const android = path.join(dir, 'android-out/app/src/main/kotlin/com/example');
  const ios = path.join(dir, 'ios-out/App');
  fs.mkdirSync(android, { recursive: true });
  fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(android, 'LoginBackendConnector.kt'), 'class LoginBackendConnector');
  fs.writeFileSync(path.join(ios, 'ProfileBackendConnector.swift'), 'final class ProfileBackendConnector {}');
  writeProject(project, {
    libraryItems: [{ id: 'lib-api-login', name: 'Login', assetType: 'api', configJson: '{"path":"/login"}' }],
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', [
    '--project',
    project,
    '--android-dir',
    path.join(dir, 'android-out'),
    '--ios-dir',
    path.join(dir, 'ios-out'),
  ], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'backend.connector-parity'));
});

test('allows generated UI event binding when no backend logic is present', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const android = path.join(dir, 'android-out/app/src/main/kotlin/com/example');
  fs.mkdirSync(android, { recursive: true });
  fs.writeFileSync(path.join(android, 'MainActivity.kt'), 'button.setOnClickListener { navigateToStage("detail") }');
  writeProject(project);
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--android-dir', path.join(dir, 'android-out')], { env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('flags explicit instruction contradictions and missing native target review', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const instructions = path.join(dir, 'instructions.md');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'CALL_API', targetLibraryItemId: 'lib-api-login' }],
    },
  });
  fs.writeFileSync(instructions, 'Build iOS and Android screens. Do not add backend, API, or network behavior.');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--instructions', instructions], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.instructions.source, instructions);
  assert.ok(report.findings.find((f) => f.code === 'instructions.backend-forbidden'));
  assert.ok(report.findings.find((f) => f.code === 'instructions.native-targets-missing'));
});

test('selected-target review accepts nested schema-2 web roots and reports mode ownership', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const exportsRoot = path.join(dir, 'exports');
  writeProject(project);
  writeHtmlExport(path.join(exportsRoot, 'web-html'));
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', [
    '--project', project,
    '--target', 'web-html',
    '--target-dir', `web-html=${exportsRoot}`,
  ], { env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.targets[0].manifestSchemaVersion, 2);
  assert.deepEqual(report.targets[0].renderModes, ['static']);
  assert.equal(report.targets[0].declaredFiles, 9);
});

test('selected-target review fails invalid schema and missing manifest-declared files', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  writeProject(project);
  const invalid = path.join(dir, 'invalid');
  writeHtmlExport(invalid, { schemaVersion: 1 });
  const { env } = unconfiguredEnv();
  const invalidResult = runBin('nui-final-review.mjs', [
    '--project', project,
    '--target', 'web-html',
    '--target-dir', `web-html=${invalid}`,
  ], { env });
  assert.equal(invalidResult.status, 1);
  assert.ok(JSON.parse(invalidResult.stdout).findings.some((finding) => finding.code === 'target.manifest-invalid'));

  const missing = path.join(dir, 'missing');
  writeHtmlExport(missing, { missing: 'sw.js' });
  const missingResult = runBin('nui-final-review.mjs', [
    '--project', project,
    '--target', 'web-html',
    '--target-dir', `web-html=${missing}`,
  ], { env });
  assert.equal(missingResult.status, 1);
  assert.ok(JSON.parse(missingResult.stdout).findings.some((finding) => finding.code === 'target.declared-file-missing'));
});
