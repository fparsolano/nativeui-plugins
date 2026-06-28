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

test('responsive HTML with @media and flexible layout passes', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'responsive.html');
  fs.writeFileSync(html, `<!doctype html><style>
.screen { display:flex; width:100%; gap:4vw; }
.card { flex:1; min-width:0; }
@media (min-width: 768px) { .screen { display:grid; grid-template-columns: repeat(2, 1fr); } }
</style><main class="screen"><section class="card">A</section></main>`);

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary.breakpoints, [768]);
});

test('static HTML without a responsive path fails unless --allow-static is passed', () => {
  const dir = tmpdir();
  const html = path.join(dir, 'static.html');
  fs.writeFileSync(html, '<style>.screen{width:412px;height:915px}.card{width:360px}</style><main class="screen"><div class="card">A</div></main>');

  const { env } = unconfiguredEnv();
  const r = runBin('nui-responsive-audit.mjs', [html], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Responsive audit failed/);

  const allowed = runBin('nui-responsive-audit.mjs', [html, '--allow-static'], { env });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).allowStatic, true);
});

test('project.json with divisions and semantic responsive metadata passes', () => {
  const dir = tmpdir();
  const project = path.join(dir, 'project.json');
  fs.writeFileSync(project, JSON.stringify({
    version: 4,
    stages: [
      {
        name: 'Home',
        stageWidth: 412,
        stageHeight: 915,
        responsiveLayoutVersion: 1,
        divisions: [{ id: 'tablet', name: 'Tablet', minWidth: 768 }],
        rootNodes: [
          {
            kind: 'javafx.scene.layout.VBox',
            id: 'screen',
            semanticWidth: 'fill',
            divisionOverrides: { tablet: { prefWidth: '768.0' } },
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
  assert.equal(report.inputs[0].divisionCount, 1);
  assert.equal(report.inputs[0].hasResponsivePath, true);
});
