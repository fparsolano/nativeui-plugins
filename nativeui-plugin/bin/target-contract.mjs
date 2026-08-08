import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = path.resolve(BIN_DIR, '..', 'capabilities', 'nativeui-targets.json');
const CAPABILITY_CATALOG_PATH = path.resolve(BIN_DIR, '..', 'capabilities', 'nativeui-capability-catalog.json');

export function loadTargetContract() {
  return JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
}

export function loadCapabilityCatalog() {
  return JSON.parse(fs.readFileSync(CAPABILITY_CATALOG_PATH, 'utf8'));
}

export function targetById(id, contract = loadTargetContract()) {
  return contract.targets.find((target) => target.id === id) || null;
}

export function expandTargetToken(token, contract = loadTargetContract()) {
  const value = String(token || '').trim().toLowerCase();
  if (!value) return [];
  if (value === 'auto') return [...contract.defaultTargets];
  if (contract.groups[value]) return [...contract.groups[value]];
  if (value === 'ios') return ['ios-swiftui'];
  if (value === 'android') return ['android-compose'];
  if (value === 'web') return ['web-html'];
  if (targetById(value, contract)) return [value];
  throw new Error(`Unknown NativeUI target '${token}'. Run nui-capabilities matrix for valid target IDs.`);
}

export function resolveTargets(tokens, { allTargets = false, defaults = false } = {}) {
  const contract = loadTargetContract();
  const requested = allTargets
    ? contract.groups.all
    : (tokens || []).flatMap((token) => expandTargetToken(token, contract));
  const values = requested.length ? requested : defaults ? contract.defaultTargets : [];
  return [...new Set(values)].map((id) => targetById(id, contract));
}

export function exportRequests(targets) {
  const requests = [];
  const shared = new Set();
  for (const target of targets) {
    if (!target) continue;
    if (target.platform === 'rust' || target.platform === 'csharp') {
      if (shared.has(target.platform)) continue;
      shared.add(target.platform);
      requests.push({ key: target.platform, platform: target.platform, targets: targets.filter((item) => item.platform === target.platform) });
    } else {
      requests.push({ key: target.id, platform: target.platform, targets: [target] });
    }
  }
  return requests;
}

// A read-only projection for agents and integrations. It deliberately shares the
// target/capability files used by the CLI so a bridge or MCP server cannot grow a
// stale, independently maintained list of lanes, render modes, or dispositions.
export function deliveryCapabilityProjection({ surface = 'all', targetIds = [], includeCapabilityMatrix = false } = {}) {
  const contract = loadTargetContract();
  const normalizedSurface = String(surface || 'all').trim().toLowerCase();
  if (!['all', 'mobile', 'web', 'desktop'].includes(normalizedSurface)) {
    throw new Error(`Unknown delivery surface '${surface}'. Use mobile, web, desktop, or all.`);
  }

  const requestedIds = [...new Set((targetIds || []).map((id) => String(id).trim()).filter(Boolean))];
  const profile = normalizedSurface === 'all' ? null : contract.deliveryProfiles?.[normalizedSurface];
  const selectedIds = requestedIds.length
    ? requestedIds
    : profile?.defaultSelection?.targetIds || (normalizedSurface === 'all' ? contract.groups?.all || [] : []);
  const targets = selectedIds.map((id) => {
    const target = targetById(id, contract);
    if (!target) throw new Error(`Unknown NativeUI target '${id}'. Run nui-capabilities matrix for valid target IDs.`);
    return target;
  });

  const projection = {
    schemaVersion: contract.schemaVersion,
    authoringDefaults: contract.authoringDefaults,
    surface: normalizedSurface,
    deliveryProfile: profile,
    targets,
  };
  if (!includeCapabilityMatrix) return projection;

  const catalog = loadCapabilityCatalog();
  projection.capabilityCatalog = {
    schemaVersion: catalog.schemaVersion,
    manifestVersion: catalog.manifestVersion,
    enforcementPhase: catalog.enforcementPhase,
    capabilities: (catalog.capabilities || []).map((capability) => ({
      ...capability,
      targetSupport: Object.fromEntries(
        selectedIds
          .filter((id) => capability.targetSupport?.[id])
          .map((id) => [id, capability.targetSupport[id]]),
      ),
    })),
  };
  return projection;
}

export { TARGETS_PATH, CAPABILITY_CATALOG_PATH };
