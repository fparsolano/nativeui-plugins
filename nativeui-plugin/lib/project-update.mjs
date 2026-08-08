import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

export function signature(value) {
  return JSON.stringify(stableValue(value));
}

export function mergeInteractions(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const key = signature(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function replaceReferences(value, from, to) {
  if (Array.isArray(value)) return value.map((item) => replaceReferences(item, from, to));
  if (!value || typeof value !== 'object') return value === from ? to : value;
  for (const [key, item] of Object.entries(value)) {
    value[key] = replaceReferences(item, from, to);
  }
  return value;
}

const LEGACY_NODE_REFERENCE_PARAM_KEYS = [
  'targetNodeId',
  'formNodeId',
  'formId',
  'valueNodeId',
];

function remapNodeId(value, from, to) {
  return value === from ? to : value;
}

function remapNodeReferenceField(carrier, key, from, to) {
  if (!carrier || typeof carrier !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(carrier, key)) {
    carrier[key] = remapNodeId(carrier[key], from, to);
  }
}

function remapLegacyNodeReferenceParams(params, from, to) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;
  for (const key of LEGACY_NODE_REFERENCE_PARAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      params[key] = remapNodeId(params[key], from, to);
    }
  }
}

/**
 * Remap a template-root node id only through fields whose model type is a node reference.
 * Ordinary strings remain application data even when their value happens to equal the old id.
 * Keep this carrier list aligned with the typed Library expansion seam in nui-core.
 */
export function remapTypedNodeReferences(node, from, to) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;

  for (const key of ['graphicSourceNodeId', 'nodeRefId']) {
    remapNodeReferenceField(node, key, from, to);
  }
  if (node.nodeRefProps && typeof node.nodeRefProps === 'object') {
    for (const key of Object.keys(node.nodeRefProps)) {
      node.nodeRefProps[key] = remapNodeId(node.nodeRefProps[key], from, to);
    }
  }
  if (node.formControl && typeof node.formControl === 'object') {
    remapNodeReferenceField(node.formControl, 'formId', from, to);
  }
  for (const binding of Array.isArray(node.bindings) ? node.bindings : []) {
    if (binding && typeof binding === 'object') {
      remapNodeReferenceField(binding, 'repeaterId', from, to);
    }
  }
  if (node.repeater && typeof node.repeater === 'object') {
    remapNodeReferenceField(node.repeater, 'repeaterId', from, to);
  }
  if (node.repeaterInstance && typeof node.repeaterInstance === 'object') {
    remapNodeReferenceField(node.repeaterInstance, 'repeaterId', from, to);
    remapNodeReferenceField(node.repeaterInstance, 'templateNodeId', from, to);
  }
  for (const interaction of Array.isArray(node.interactions) ? node.interactions : []) {
    if (!interaction || typeof interaction !== 'object') continue;
    remapNodeReferenceField(interaction, 'targetNodeId', from, to);
    remapLegacyNodeReferenceParams(interaction.params, from, to);
  }
  for (const interaction of Array.isArray(node.interactionSpecs) ? node.interactionSpecs : []) {
    const action = interaction?.action;
    if (!action || typeof action !== 'object') continue;
    remapNodeReferenceField(action, 'targetNodeId', from, to);
    remapNodeReferenceField(action, 'formNodeId', from, to);
  }
  if (node.eventBindings && typeof node.eventBindings === 'object') {
    for (const binding of Object.values(node.eventBindings)) {
      if (!binding || typeof binding !== 'object') continue;
      remapNodeReferenceField(binding, 'targetNodeId', from, to);
      remapLegacyNodeReferenceParams(binding.params, from, to);
    }
  }

  for (const field of ['children', 'skinSubcomponents']) {
    for (const child of Array.isArray(node[field]) ? node[field] : []) {
      remapTypedNodeReferences(child, from, to);
    }
  }
  for (const field of ['graphicNode', 'clipNode']) {
    remapTypedNodeReferences(node[field], from, to);
  }
}

function collectLibraryNodeInterface(node, nodeIds, libraryReferences) {
  if (!node || typeof node !== 'object') return;
  if (node.id) nodeIds.push(node.id);
  if (node.libraryItemId) libraryReferences.push(node.libraryItemId);
  for (const field of ['children', 'skinSubcomponents']) {
    if (Array.isArray(node[field])) {
      node[field].forEach((child) =>
        collectLibraryNodeInterface(child, nodeIds, libraryReferences)
      );
    }
  }
  for (const field of ['graphicNode', 'clipNode']) {
    collectLibraryNodeInterface(node[field], nodeIds, libraryReferences);
  }
}

function libraryItemInterfaceSignature(item) {
  const nodeIds = [];
  const libraryReferences = [];
  collectLibraryNodeInterface(item?.rootNode, nodeIds, libraryReferences);
  // A materialized occurrence carries its parameter overrides back through HTML as the promoted
  // definition's defaults. Those values are payload, not interface: the destination dependency
  // remains authoritative for them. Names/types/roles/fields/labels still participate so a real
  // public parameter change fails closed.
  const parameterSchema = (Array.isArray(item?.parameterSchema) ? item.parameterSchema : [])
    .map(({ defaultValue: _occurrenceProjection, ...definition }) => definition);
  return signature({
    name: item?.name || null,
    assetType: item?.assetType || null,
    parameterSchema,
    eventSchema: Array.isArray(item?.eventSchema) ? item.eventSchema : [],
    rootNodeId: item?.rootNode?.id || null,
    rootNodeKind: item?.rootNode?.kind || null,
    nodeIds: nodeIds.sort(),
    libraryReferences: libraryReferences.sort(),
  });
}

function materializedOccurrenceInterfaceCompatible(existingItem, importedItem) {
  const existingNodeIds = [];
  const existingLibraryReferences = [];
  const importedNodeIds = [];
  const importedLibraryReferences = [];
  collectLibraryNodeInterface(
    existingItem?.rootNode,
    existingNodeIds,
    existingLibraryReferences
  );
  collectLibraryNodeInterface(
    importedItem?.rootNode,
    importedNodeIds,
    importedLibraryReferences
  );
  if (existingNodeIds.length !== importedNodeIds.length) return false;

  // Fragment export must namespace repeated materialized occurrences to keep DOM ids unique.
  // Re-import therefore sees `<occurrence-id>__<template-node-id>` even though the shared
  // component interface still owns `<template-node-id>`. Accept only that exact exporter shape:
  // every imported id must map one-to-one either directly or by one `__` suffix to a canonical
  // destination id. Missing, added, ambiguous, or merely similarly-suffixed nodes remain drift.
  const unusedExisting = new Set(existingNodeIds);
  const normalizedImported = [];
  for (const importedId of importedNodeIds) {
    let canonical = unusedExisting.has(importedId) ? importedId : null;
    if (!canonical) {
      const candidates = [...unusedExisting]
        .filter((existingId) => importedId.endsWith(`__${existingId}`));
      if (candidates.length !== 1) return false;
      [canonical] = candidates;
    }
    unusedExisting.delete(canonical);
    normalizedImported.push(canonical);
  }
  if (unusedExisting.size !== 0) return false;

  const project = (item, nodeIds, libraryReferences) => {
    const parameterSchema = (Array.isArray(item?.parameterSchema) ? item.parameterSchema : [])
      .map(({ defaultValue: _occurrenceProjection, ...definition }) => definition);
    return signature({
      name: item?.name || null,
      assetType: item?.assetType || null,
      parameterSchema,
      eventSchema: Array.isArray(item?.eventSchema) ? item.eventSchema : [],
      rootNodeId: item?.rootNode?.id || null,
      rootNodeKind: item?.rootNode?.kind || null,
      nodeIds: nodeIds.sort(),
      libraryReferences: libraryReferences.sort(),
    });
  };
  return project(existingItem, existingNodeIds, existingLibraryReferences) ===
    project(importedItem, normalizedImported, importedLibraryReferences);
}

function libraryItemInterfaceCompatible(existingItem, importedItem) {
  return libraryItemInterfaceSignature(existingItem) === libraryItemInterfaceSignature(importedItem)
    || materializedOccurrenceInterfaceCompatible(existingItem, importedItem);
}

function contentReferencesLibraryItem(value, libraryItemId) {
  if (Array.isArray(value)) {
    return value.some((item) => contentReferencesLibraryItem(item, libraryItemId));
  }
  if (!value || typeof value !== 'object') return false;
  if (value.libraryReference === true && value.libraryItemId === libraryItemId) return true;
  return Object.values(value).some((item) =>
    contentReferencesLibraryItem(item, libraryItemId)
  );
}

/**
 * Merge imported Library artifacts without silently overwriting an existing artifact.
 * References in both imported content and imported artifacts follow any deterministic
 * collision remap. Whole-screen and fragment updates share this exact operation.
 */
export function mergeLibraryItems(
  project,
  importedItems,
  importedContent,
  updateSharedLibrary = false,
  targetLibraryItemId = undefined
) {
  const existing = Array.isArray(project.libraryItems) ? [...project.libraryItems] : [];
  const byId = new Map(existing.map((item, index) => [item.id, { item, index }]));
  const remapped = [];
  for (const imported of importedItems || []) {
    if (!imported?.id) continue;
    const match = byId.get(imported.id);
    if (!match) {
      byId.set(imported.id, { item: imported, index: existing.length });
      existing.push(imported);
      continue;
    }
    if (JSON.stringify(match.item) === JSON.stringify(imported)) continue;
    if (!updateSharedLibrary && contentReferencesLibraryItem(importedContent, imported.id)) {
      // A stage occurrence imports a materialized projection of its shared component. The
      // destination Library definition remains canonical: reuse it when the public interface is
      // compatible instead of cloning the component under a collision suffix. Editing the shared
      // payload is a separate, explicit --update-shared-library operation.
      if (libraryItemInterfaceCompatible(match.item, imported)) continue;
      throw new Error(
        `Imported Library reference "${imported.id}" has an incompatible shared interface; ` +
          'update that shared Library item explicitly before splicing the occurrence.'
      );
    }
    if (updateSharedLibrary) {
      if (targetLibraryItemId !== undefined && imported.id !== targetLibraryItemId) {
        // A fragment export materializes the target component and all of its transitive
        // dependencies. The HTML importer reconstructs those dependency payloads, so layout
        // defaults and baked style values can legitimately differ even on a no-op round trip.
        // They are not part of this scoped edit: retain the destination dependency whenever its
        // public component interface (parameter schema and reference topology) is compatible.
        if (libraryItemInterfaceCompatible(match.item, imported)) {
          continue;
        }
        throw new Error(
          `Imported dependency "${imported.id}" has an incompatible shared Library interface; ` +
            `fragment updates may replace only target "${targetLibraryItemId || '(none)'}".`
        );
      }
      // Fragment HTML edits a materialized Library occurrence. Re-import reconstructs the
      // component graph from that occurrence, but the destination remains the authority for its
      // template-root id (older projects did not require the `<library-id>_root` convention).
      // Preserve it while replacing the authored payload so references/recipes by node id remain
      // stable across extract -> edit -> atomic splice.
      if (match.item?.rootNode?.id && imported?.rootNode) {
        const importedRootId = imported.rootNode.id;
        const destinationRootId = match.item.rootNode.id;
        if (importedRootId && importedRootId !== destinationRootId) {
          remapTypedNodeReferences(imported.rootNode, importedRootId, destinationRootId);
        }
        imported.rootNode.id = destinationRootId;
      }
      existing[match.index] = imported;
      continue;
    }
    const oldId = imported.id;
    const suffix = createHash('sha256')
      .update(JSON.stringify(imported))
      .digest('hex')
      .slice(0, 8);
    let newId = `${oldId}-import-${suffix}`;
    let index = 2;
    while (byId.has(newId)) newId = `${oldId}-import-${suffix}-${index++}`;
    imported.id = newId;
    replaceReferences(importedContent, oldId, newId);
    replaceReferences(importedItems, oldId, newId);
    existing.push(imported);
    byId.set(newId, { item: imported, index: existing.length - 1 });
    remapped.push({ from: oldId, to: newId });
  }
  return { libraryItems: existing, remapped };
}

export function validateProjectStructure(project) {
  if (!project || typeof project !== 'object') {
    throw new Error('Project must be a JSON object.');
  }
  if (!Array.isArray(project.stages) || project.stages.length === 0) {
    throw new Error('Project must contain at least one stage.');
  }
  for (const [index, stage] of project.stages.entries()) {
    if (!stage || !Array.isArray(stage.rootNodes) || stage.rootNodes.length === 0) {
      throw new Error(`Stage ${stage?.stageId || stage?.name || index + 1} has no rootNodes.`);
    }
  }
  if (project.libraryItems != null && !Array.isArray(project.libraryItems)) {
    throw new Error('project.libraryItems must be an array when present.');
  }
}

export async function writeProjectAtomically(projectPath, project, tag = 'nativeui-update') {
  validateProjectStructure(project);
  const output = path.resolve(projectPath);
  const temporary = `${output}.${tag}-${process.pid}.tmp`;
  try {
    let indentation = 2;
    try {
      const existing = await fs.readFile(output, 'utf8');
      const match = existing.match(/\n([ \t]+)"/);
      if (match) {
        indentation = match[1].includes('\t')
          ? '\t'
          : Math.max(1, Math.min(10, match[1].length));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.writeFile(temporary, JSON.stringify(project, null, indentation) + '\n');
    const candidate = JSON.parse(await fs.readFile(temporary, 'utf8'));
    validateProjectStructure(candidate);
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return output;
}
