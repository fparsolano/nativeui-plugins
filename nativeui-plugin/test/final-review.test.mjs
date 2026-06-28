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

function writeProject(file, extra = {}) {
  fs.writeFileSync(file, JSON.stringify({
    version: 4,
    libraryItems: extra.libraryItems || [],
    stages: [
      {
        name: 'Login',
        stageWidth: 412,
        stageHeight: 915,
        responsiveLayoutVersion: 1,
        divisions: [{ id: 'tablet', minWidth: 768 }],
        rootNodes: [
          {
            kind: 'javafx.scene.layout.VBox',
            id: 'login_screen',
            semanticWidth: 'fill',
            children: [
              { kind: 'javafx.scene.control.Button', id: 'login_button', text: 'Log in' },
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

## Recommended Stack
- Stack: Node/Hono.

## Alternatives
- Python/FastAPI.

## Local Run Plan
- Command: npm run dev

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

test('passes a responsive project/html with no backend events', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project);
  fs.writeFileSync(html, '<style>.screen{display:flex;width:100%}@media (min-width:768px){.screen{display:grid;grid-template-columns:1fr 1fr}}</style><main id="screen" class="screen"></main>');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--html', html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
});

test('allows supported radial gradients and warns on conic gradients only', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project);
  fs.writeFileSync(html, '<style>.screen{display:flex;width:100%;background:radial-gradient(circle,#fff,#ddd)}@media (min-width:768px){.screen{background:conic-gradient(red, blue);}}</style><main id="screen" class="screen"></main>');
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

test('fails on static HTML and no-runtime events', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  const html = path.join(dir, 'home.html');
  writeProject(project, {
    node: {
      interactions: [{ trigger: 'CLICK', action: 'RUN_SCRIPT', params: { handler: 'save()' } }],
    },
  });
  fs.writeFileSync(html, '<script>save()</script><style>.screen{width:412px}.hero{background:url("https://example.com/a.png")}</style><main class="screen"></main>');
  const { env } = unconfiguredEnv();
  const r = runBin('nui-final-review.mjs', ['--project', project, '--html', html], { env });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.findings.find((f) => f.code === 'html.script'));
  assert.ok(report.findings.find((f) => f.code === 'asset.remote-image'));
  assert.ok(report.findings.find((f) => f.code === 'responsive.html-missing'));
  assert.ok(report.findings.find((f) => f.code === 'event.no-runtime-action'));
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
