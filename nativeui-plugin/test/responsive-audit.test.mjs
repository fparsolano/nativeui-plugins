// responsive-audit.test.mjs - nui-responsive-audit.mjs gates generated designs
// on a real responsive path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBin, unconfiguredEnv } from './helpers.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nui-resp-'));
}

test('content-driven fluid HTML passes without device-specific breakpoints', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'responsive.html');
  fs.writeFileSync(html, `<!doctype html><style>
body { margin:0; width:100%; min-width:0; }
.screen { display:grid; width:100%; min-width:0; gap:clamp(0.5rem, 2vw, 2rem); grid-template-columns:repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
.card { flex:1; min-width:0; }
</style><body><main class="screen"><section class="card">A</section></main></body>`);

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary.breakpoints, []);
  assert.deepEqual(report.inputs[0].breakpointCoverage, {});
  assert.deepEqual(report.inputs[0].requiredBreakpoints, []);
  assert.equal(report.inputs[0].parentConstraints.fluidRoot, true);
  assert.deepEqual(report.inputs[0].fixedWidthSmells, []);
});

test('authored media thresholds are reported without preset band requirements', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'authored-threshold.html');
  fs.writeFileSync(html, `<!doctype html><style>
body { width:100%; min-width:0; }
.screen { display:flex; flex-wrap:wrap; width:100%; min-width:0; }
.card { flex:1; min-width:0; }
@media (min-width: 731px) { .card { flex-basis:20rem; } }
</style><body><main class="screen"><section class="card">A</section></main></body>`);

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.inputs[0].breakpointCoverage, { '731px': true });
  assert.deepEqual(report.inputs[0].requiredBreakpoints, []);
  assert.deepEqual(report.inputs[0].targetCoverage, [{ name: 'authored-1', width: 731, covered: true }]);
  assert.deepEqual(report.targets, [{ name: 'authored-1', width: 731 }]);
});

test('fixed-canvas HTML cannot bypass the responsive contract with deprecated --allow-static', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'fixed-canvas.html');
  fs.writeFileSync(html, '<style>body{width:100%;min-width:0}.screen{display:flex;width:417px;height:913px;min-width:0}.card{flex:1;min-width:0}</style><main class="screen"><div class="card">A</div></main>');

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Responsive audit failed/);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootWidths, [417]);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootHeights, [913]);

  const allowed = runBin('nui-responsive-audit.mjs', [html, '--allow-static'], { env });
  assert.equal(allowed.status, 1);
  assert.equal(JSON.parse(allowed.stdout).allowStaticIgnored, true);
});

test('a fluid body cannot hide a fixed page wrapper', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'fixed-page.html');
  fs.writeFileSync(html, `<!doctype html><style>
body { width:100%; min-width:0; display:flex; }
.page { display:flex; width:417px; height:913px; min-width:0; }
.content { flex:1; min-width:0; }
</style><body><main class="page"><div class="content">A</div></main></body>`);

  const { env } = unconfiguredEnv();
  const result = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootWidths, [417]);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootHeights, [913]);
  assert.match(report.inputs[0].warnings.join(' '), /fixed root/i);
});

test('nested route-root min and max pixel constraints fail closed', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'nested-fixed-route.html');
  fs.writeFileSync(html, `<!doctype html><style>
body { width:100%; min-width:0; display:flex; }
#route-dashboard { width:100%; min-width:0; display:flex; }
@media (min-width: 70rem) {
  #route-dashboard { max-width:1200px; }
}
.page-canvas {
  @media (orientation: landscape) {
    min-block-size:800px;
  }
}
</style><body><main id="route-dashboard" class="page-canvas"><div>A</div></main></body>`);

  const { env } = unconfiguredEnv();
  const result = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootWidths, [1200]);
  assert.deepEqual(report.inputs[0].parentConstraints.fixedRootHeights, [800]);
});

test('literal stage roots under route wrappers are audited but intrinsic descendants remain valid', () => {
  const dir = tmpdir();
  const fixed = path.join(dir, 'fixed-stage-root.html');
  fs.writeFileSync(fixed, `<!doctype html><style>
body { width:100%; min-width:0; display:flex; }
.page { width:100%; min-width:0; display:flex; }
#home-root { width:417px; max-height:913px; display:flex; min-width:0; }
#home-root .card { width:320px; height:180px; }
</style><body><main id="route-home" class="page"><h1 id="page-title" class="visually-hidden">Home</h1><section id="home-root"><article class="card">A</article></section></main></body>`);

  const { env } = unconfiguredEnv();
  const rejected = runBin('nui-responsive-audit.mjs', [fixed], { env });
  assert.equal(rejected.status, 1);
  const rejectedReport = JSON.parse(rejected.stdout);
  assert.deepEqual(rejectedReport.inputs[0].parentConstraints.fixedRootWidths, [417]);
  assert.deepEqual(rejectedReport.inputs[0].parentConstraints.fixedRootHeights, [913]);

  const fluid = path.join(dir, 'fluid-stage-root.html');
  fs.writeFileSync(fluid, `<!doctype html><style>
body { width:100%; min-width:0; display:flex; }
.page { width:100%; min-width:0; display:flex; }
#home-root { width:100%; min-width:0; display:flex; flex:1; }
#home-root .card { width:320px; height:180px; max-width:420px; }
</style><body><main id="route-home" class="page"><section id="home-root"><article class="card">A</article></section></main></body>`);
  const accepted = runBin('nui-responsive-audit.mjs', [fluid], { env });
  assert.equal(accepted.status, 0, accepted.stderr);
  const acceptedReport = JSON.parse(accepted.stdout);
  assert.deepEqual(acceptedReport.inputs[0].parentConstraints.fixedRootWidths, []);
  assert.deepEqual(acceptedReport.inputs[0].parentConstraints.fixedRootHeights, []);
});

test('project.json with fluid parent constraints passes without divisions', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  fs.writeFileSync(project, JSON.stringify({
    version: 4,
    stages: [
      {
        name: 'Home',
        responsiveLayoutVersion: 1,
        divisions: [],
        rootNodes: [
          {
            kind: 'javafx.scene.layout.VBox',
            id: 'screen',
            semanticWidth: 'fill',
            parentLayoutProps: { 'nui.semanticWidth': '100%', 'anchor.left': '0', 'anchor.right': '0' },
            children: [],
          },
        ],
      },
    ],
  }, null, 2));

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [project], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.inputs[0].kind, 'project-json');
  assert.equal(report.inputs[0].divisionCount, 0);
  assert.deepEqual(report.inputs[0].breakpointCoverage, {});
  assert.deepEqual(report.inputs[0].requiredBreakpoints, []);
  assert.equal(report.inputs[0].hasResponsivePath, true);
  assert.deepEqual(report.inputs[0].fixedHeightSmells, []);
});

test('project.json cannot hide a fixed root height behind fluid inline sizing', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'fixed-height-project.json');
  fs.writeFileSync(project, JSON.stringify({
    version: 9,
    responsiveLayoutVersion: 1,
    stages: [{
      name: 'Home',
      responsiveLayoutVersion: 1,
      rootNodes: [{
        kind: 'javafx.scene.layout.VBox',
        id: 'screen',
        semanticWidth: 'fill',
        prefHeight: 913,
        parentLayoutProps: { 'nui.semanticWidth': '100%', 'anchor.left': '0', 'anchor.right': '0' },
        children: [],
      }],
    }],
  }, null, 2));

  const { env } = unconfiguredEnv();
  const result = runBin('nui-responsive-audit.mjs', [project], { env });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputs[0].hasResponsivePath, false);
  assert.deepEqual(report.inputs[0].fixedWidthSmells, []);
  assert.deepEqual(report.inputs[0].fixedHeightSmells, [
    { stage: 'Home', nodeId: 'screen', field: 'prefHeight', value: 913 },
  ]);
  assert.match(report.inputs[0].warnings.join(' '), /fixed root height/i);
});
