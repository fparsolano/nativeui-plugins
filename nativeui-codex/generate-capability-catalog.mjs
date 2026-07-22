#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'nui-core/src/main/resources/html-flagship-capabilities-v2.json');
const targetsPath = path.join(ROOT, 'nativeui-plugin/capabilities/nativeui-targets.json');
const outputPath = path.join(ROOT, 'nativeui-plugin/capabilities/nativeui-capability-catalog.json');

function laneDisposition(capability, target) {
  if (capability.disposition === 'COMPILED_AWAY') return 'COMPILED_AWAY';
  if (capability.disposition === 'GATED') return 'GATED';
  const lane = target.id === 'ios-swiftui' ? 'swiftUi'
    : target.id === 'android-compose' ? 'compose'
      : target.platform === 'rust' ? 'rust'
        : target.platform === 'web' ? 'web' : '';
  const lowering = lane ? capability.laneLowering?.[lane]?.disposition : null;
  if (lowering === 'COMPILED_AWAY') return 'COMPILED_AWAY';
  if (lowering === 'GATED') return 'GATED';
  return 'IMPLEMENTED';
}

function declarationSupport(declaration, target) {
  const lane = target.id === 'ios-swiftui' ? 'swiftUi'
    : target.id === 'android-compose' ? 'compose'
      : target.platform === 'rust' ? 'rust'
        : target.platform === 'csharp' ? 'csharp'
          : target.platform === 'web' ? 'web' : '';
  const disposition = declaration.disposition || declaration.laneLowering?.[lane]?.disposition || 'IMPLEMENTED';
  return {
    disposition: ['COMPILED_AWAY', 'GATED'].includes(disposition) ? disposition : 'IMPLEMENTED',
    releaseStatus: target.releaseStatus,
    verification: target.releaseStatus === 'stable' ? 'release-gated' : 'beta-gated',
  };
}

function mapDeclarations(declarations, targets) {
  return declarations.map((declaration) => ({
    ...declaration,
    targetSupport: Object.fromEntries(targets.map((target) => [target.id, declarationSupport(declaration, target)])),
  }));
}

async function main() {
  const [manifest, targetContract] = await Promise.all([
    fs.readFile(manifestPath, 'utf8').then(JSON.parse),
    fs.readFile(targetsPath, 'utf8').then(JSON.parse),
  ]);
  const catalog = {
    schemaVersion: 1,
    generatedFrom: path.relative(ROOT, manifestPath),
    manifestVersion: manifest.manifestVersion,
    enforcementPhase: manifest.enforcementPhase,
    defaultTargets: targetContract.defaultTargets,
    groups: targetContract.groups,
    authoringDefaults: targetContract.authoringDefaults,
    deliveryProfiles: targetContract.deliveryProfiles,
    counts: {
      capabilities: manifest.capabilities.length,
      kinds: manifest.kindContracts.length,
      transportMarkers: manifest.transportMarkers.length,
      triggers: manifest.triggerContracts.length,
      actions: manifest.actionContracts.length,
      timelineProperties: manifest.timelinePropertyContracts.length,
    },
    targets: targetContract.targets,
    kindContracts: mapDeclarations(manifest.kindContracts, targetContract.targets),
    transportMarkers: mapDeclarations(manifest.transportMarkers, targetContract.targets),
    triggerContracts: mapDeclarations(manifest.triggerContracts, targetContract.targets),
    actionContracts: mapDeclarations(manifest.actionContracts, targetContract.targets),
    timelinePropertyContracts: mapDeclarations(manifest.timelinePropertyContracts, targetContract.targets),
    capabilities: manifest.capabilities.map((capability) => ({
      id: capability.id,
      valueType: capability.valueType,
      scopes: capability.scopes,
      sourceForms: capability.sourceForms,
      applicableKinds: capability.applicableKinds,
      disposition: capability.disposition,
      diagnosticCode: capability.diagnosticCode,
      fixtures: capability.fixtures,
      targetSupport: Object.fromEntries(targetContract.targets.map((target) => [target.id, {
        disposition: laneDisposition(capability, target),
        releaseStatus: target.releaseStatus,
        verification: target.releaseStatus === 'stable' ? 'release-gated' : 'beta-gated',
      }])),
    })),
  };
  await fs.writeFile(outputPath, JSON.stringify(catalog, null, 2) + '\n');
  process.stdout.write(`Generated ${path.relative(ROOT, outputPath)} (${catalog.capabilities.length} capabilities, ${catalog.targets.length} targets)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
