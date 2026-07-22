import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { attachTargetPlans, buildPlan, targetsHuman } from '../bin/nui-connectors-plan.mjs';
import { resolveTargets } from '../bin/target-contract.mjs';
import { fixture } from './helpers.mjs';

const PROJECT = fixture('backend-plan.project.json');

function webPlan() {
  const project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
  return attachTargetPlans(buildPlan(project, PROJECT), resolveTargets(['web-all']));
}

test('web target plans use each lane manifest-declared developer seams', () => {
  const plans = new Map(webPlan().targetPlans.map((plan) => [plan.targetId, plan]));

  const expected = {
    'web-html': ['app-actions.js', 'data-adapters.js', 'custom-components.js', 'contracts.d.ts', 'JavaScript'],
    'web-react': ['app/seams/app-actions.ts', 'app/seams/data-adapters.ts', 'app/seams/custom-components.ts', 'app/seams/contracts.ts', 'TypeScript'],
    'web-vue': ['app/seams/app-actions.ts', 'app/seams/data-adapters.ts', 'app/seams/custom-components.ts', 'app/seams/contracts.ts', 'TypeScript'],
    'web-angular': ['src/app/seams/app-actions.ts', 'src/app/seams/data-adapters.ts', 'src/app/seams/custom-components.ts', 'src/app/seams/contracts.ts', 'TypeScript'],
    'web-astro': ['src/seams/app-actions.ts', 'src/seams/data-adapters.ts', 'src/seams/custom-components.ts', 'src/seams/contracts.ts', 'TypeScript'],
  };

  for (const [targetId, files] of Object.entries(expected)) {
    const seam = plans.get(targetId)?.seam;
    assert.ok(seam, targetId);
    assert.deepEqual(
      [seam.appActionsFile, seam.dataAdaptersFile, seam.customComponentsFile, seam.generatedContractFile, seam.language],
      files,
      targetId,
    );
    assert.equal(seam.asyncContract, 'Promise<ActionResult>');
    assert.match(seam.preservation.changedContract, /\.new/);
    assert.ok(!JSON.stringify(seam).includes('runtime.js'));
  }
});

test('human web plan prints lane-specific action, adapter, and component paths', () => {
  const project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
  const plan = attachTargetPlans(buildPlan(project, PROJECT), resolveTargets(['web-angular']));
  const output = targetsHuman(plan);
  assert.match(output, /src\/app\/seams\/app-actions\.ts/);
  assert.match(output, /src\/app\/seams\/data-adapters\.ts/);
  assert.match(output, /src\/app\/seams\/custom-components\.ts/);
  assert.doesNotMatch(output, /runtime\.js/);
});
