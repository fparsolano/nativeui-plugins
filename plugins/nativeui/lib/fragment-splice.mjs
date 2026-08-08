import {
  mergeLibraryItems,
  remapTypedNodeReferences,
  replaceReferences,
  signature,
  validateProjectStructure,
} from './project-update.mjs';

const NODE_LIST_FIELDS = ['children', 'skinSubcomponents'];
const NODE_SLOT_FIELDS = ['graphicNode', 'clipNode'];
const STRUCTURAL_PATCH_FIELDS = new Set([
  'id',
  'children',
  'skinSubcomponents',
  'graphicNode',
  'clipNode',
  'rootNodes',
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return value != null && Object.prototype.hasOwnProperty.call(value, key);
}

function sameValue(left, right) {
  return signature(left) === signature(right);
}

function uniquelyKeyedById(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  const ids = new Set();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.id) return false;
    if (ids.has(value.id)) return false;
    ids.add(value.id);
  }
  return true;
}

function nestedNodeValuesById(values) {
  const byId = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value.id) {
      const matches = byId.get(value.id) || [];
      matches.push(value);
      byId.set(value.id, matches);
    }
    for (const field of NODE_LIST_FIELDS) {
      for (const child of Array.isArray(value[field]) ? value[field] : []) visit(child);
    }
    for (const field of NODE_SLOT_FIELDS) visit(value[field]);
  };
  for (const value of Array.isArray(values) ? values : []) visit(value);
  return byId;
}

function uniqueNestedNode(byId, id) {
  const matches = byId.get(id) || [];
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Reconcile an importer-only layout wrapper back into the canonical sibling list. A no-op
 * export/import can group direct children under `nui_flow`; a later recipe may then patch one of
 * those stable descendants. Re-emitting the wrapper would be a structural edit the author never
 * made, while recursively merging it without a canonical source produces sparse `{children:
 * [patch,null]}` objects. Flatten only when the wrapper shell itself is byte-unchanged and every
 * previously projected descendant resolves uniquely in the canonical tree. Newly authored
 * descendants remain legitimate direct additions.
 */
function reconcileImporterOnlyWrapper(canonicalValues, baselineWrapper, editedWrapper) {
  if (!baselineWrapper?.id || baselineWrapper.id !== editedWrapper?.id) return null;
  const baselineShell = clone(baselineWrapper);
  const editedShell = clone(editedWrapper);
  for (const field of [...NODE_LIST_FIELDS, ...NODE_SLOT_FIELDS]) {
    delete baselineShell[field];
    delete editedShell[field];
  }
  if (!sameValue(baselineShell, editedShell)) return null;

  const populatedFields = NODE_LIST_FIELDS.filter((field) =>
    Array.isArray(baselineWrapper[field]) && baselineWrapper[field].length > 0
  );
  if (populatedFields.length !== 1) return null;
  const field = populatedFields[0];
  const beforeChildren = baselineWrapper[field];
  const editedChildren = editedWrapper[field];
  if (!uniquelyKeyedById(beforeChildren) || !uniquelyKeyedById(editedChildren)) return null;
  for (const slot of NODE_SLOT_FIELDS) {
    if (!sameValue(baselineWrapper[slot], editedWrapper[slot])) return null;
  }

  const baselineById = new Map(beforeChildren.map((value) => [value.id, value]));
  const baselineNestedById = nestedNodeValuesById(beforeChildren);
  const canonicalNestedById = nestedNodeValuesById(canonicalValues);
  const flattened = [];
  for (const value of editedChildren) {
    const before = baselineById.get(value.id) || uniqueNestedNode(baselineNestedById, value.id);
    if (before === undefined) {
      flattened.push(clone(value));
      continue;
    }
    const canonicalValue = uniqueNestedNode(canonicalNestedById, value.id);
    if (canonicalValue === undefined) return null;
    flattened.push(applyAuthoredProjectionDelta(canonicalValue, before, value));
  }
  return {
    values: flattened,
    preserveCanonicalOrder: sameValue(
      beforeChildren.map((value) => value.id),
      editedChildren.map((value) => value.id)
    ),
  };
}

/**
 * Apply only the authored difference between two importer projections to the canonical model.
 * The no-op importer projection can legitimately materialize defaults or omit captured runtime
 * fields, so replacing the canonical Library item with it is lossy. Arrays of model nodes merge
 * by stable id; ordinary arrays merge by index when their shape is unchanged.
 */
export function applyAuthoredProjectionDelta(canonical, baseline, edited) {
  if (sameValue(baseline, edited)) return clone(canonical);
  if (Array.isArray(baseline) && Array.isArray(edited)) {
    if (uniquelyKeyedById(baseline) && uniquelyKeyedById(edited)) {
      const canonicalById = new Map(
        (Array.isArray(canonical) ? canonical : [])
          .filter((value) => value?.id)
          .map((value) => [value.id, value])
      );
      const baselineById = new Map(baseline.map((value) => [value.id, value]));
      const canonicalNestedById = nestedNodeValuesById(canonical);
      const baselineNestedById = nestedNodeValuesById(baseline);
      const merged = [];
      let preserveCanonicalOrder = false;
      for (const value of edited) {
        // A no-op HTML round trip may add a layout-only wrapper such as `nui_flow`, while the
        // authored source keeps those same stable nodes as direct siblings. Reconcile a unique
        // descendant with the same id before classifying it as newly authored.
        const before = baselineById.get(value.id) ||
          uniqueNestedNode(baselineNestedById, value.id);
        const canonicalValue = canonicalById.get(value.id) ||
          uniqueNestedNode(canonicalNestedById, value.id);
        if (before !== undefined && canonicalValue === undefined) {
          const flattened = reconcileImporterOnlyWrapper(canonical, before, value);
          if (flattened) {
            merged.push(...flattened.values);
            preserveCanonicalOrder ||= flattened.preserveCanonicalOrder;
            continue;
          }
        }
        merged.push(before === undefined
          ? clone(value)
          : applyAuthoredProjectionDelta(canonicalValue, before, value));
      }
      // A field that the importer cannot project cannot be deleted through HTML. Retain such
      // canonical-only nodes rather than silently dropping runtime-authored structure. A node
      // projected below an importer-only wrapper is not canonical-only.
      for (const value of Array.isArray(canonical) ? canonical : []) {
        if (value?.id && !baselineNestedById.has(value.id)) merged.push(clone(value));
      }
      if (preserveCanonicalOrder) {
        const canonicalOrder = new Map(
          (Array.isArray(canonical) ? canonical : [])
            .filter((value) => value?.id)
            .map((value, index) => [value.id, index])
        );
        merged.sort((left, right) => {
          const leftIndex = canonicalOrder.get(left?.id);
          const rightIndex = canonicalOrder.get(right?.id);
          if (leftIndex === undefined && rightIndex === undefined) return 0;
          if (leftIndex === undefined) return 1;
          if (rightIndex === undefined) return -1;
          return leftIndex - rightIndex;
        });
      }
      return merged;
    }
    if (baseline.length === edited.length) {
      return edited.map((value, index) =>
        applyAuthoredProjectionDelta(
          Array.isArray(canonical) ? canonical[index] : undefined,
          baseline[index],
          value
        )
      );
    }
    return clone(edited);
  }
  if (
    baseline && typeof baseline === 'object' && !Array.isArray(baseline) &&
    edited && typeof edited === 'object' && !Array.isArray(edited)
  ) {
    const source = canonical && typeof canonical === 'object' && !Array.isArray(canonical)
      ? canonical : {};
    const merged = {};
    const keys = new Set([
      ...Object.keys(source),
      ...Object.keys(baseline),
      ...Object.keys(edited),
    ]);
    for (const key of keys) {
      const beforeHas = hasOwn(baseline, key);
      const editedHas = hasOwn(edited, key);
      if (!editedHas) {
        if (!beforeHas && hasOwn(source, key)) merged[key] = clone(source[key]);
        continue;
      }
      if (!beforeHas) {
        merged[key] = clone(edited[key]);
        continue;
      }
      const value = applyAuthoredProjectionDelta(source[key], baseline[key], edited[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  return clone(edited);
}

function applySharedTargetAuthoredDelta(
  project,
  targetNode,
  fragment,
  baselineFragment,
  targetLibraryItemId
) {
  if (!targetLibraryItemId) return false;
  if (!baselineFragment) {
    throw new Error(
      `Shared Library target "${targetLibraryItemId}" requires a complete no-op baseline.`
    );
  }
  const requireTargetItem = (items, projection) => {
    const matches = (Array.isArray(items) ? items : [])
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item?.id === targetLibraryItemId);
    if (matches.length !== 1) {
      throw new Error(
        `Shared Library authored-delta splice requires exactly one ${projection} target item ` +
          `"${targetLibraryItemId}"; found ${matches.length}.`
      );
    }
    return matches[0];
  };
  // Validate every leg before applying the shared-definition delta. If any projection omits or
  // duplicates the shared target, replacing its canonical payload would be lossy or ambiguous.
  const existing = requireTargetItem(project.libraryItems, 'existing project');
  const baseline = requireTargetItem(baselineFragment.libraryItems, 'baseline');
  const edited = requireTargetItem(fragment.libraryItems, 'edited fragment');
  const requireRoot = (roots, projection) => {
    const count = Array.isArray(roots) ? roots.length : 0;
    if (count !== 1) {
      throw new Error(
        `Shared Library authored-delta splice requires exactly one ${projection} root; ` +
          `found ${count}.`
      );
    }
    return roots[0];
  };
  requireRoot(baselineFragment.rootNodes, 'baseline');
  requireRoot(fragment.rootNodes, 'edited fragment');

  // The imported root is a materialized authoring occurrence. The canonical stage occurrence is
  // deliberately a thin Library reference and owns its placement/visibility shell, so an HTML
  // edit updates the shared definition below without replacing that shell's geometry or state.
  fragment.rootNodes[0] = clone(targetNode);
  fragment.libraryItems[edited.index] = applyAuthoredProjectionDelta(
    existing.item,
    baseline.item,
    edited.item
  );
  return true;
}

function applyNonLibraryTargetAuthoredDelta(
  targetNode,
  fragment,
  baselineFragment,
  targetLibraryItemId
) {
  if (targetLibraryItemId || !baselineFragment) return false;
  const requireRoot = (roots, projection) => {
    const count = Array.isArray(roots) ? roots.length : 0;
    if (count !== 1) {
      throw new Error(
        `Non-Library authored-delta splice requires exactly one ${projection} root; ` +
          `found ${count}.`
      );
    }
    return roots[0];
  };
  const baselineRoot = requireRoot(baselineFragment.rootNodes, 'baseline');
  const editedRoot = requireRoot(fragment.rootNodes, 'edited fragment');
  fragment.rootNodes[0] = applyAuthoredProjectionDelta(
    targetNode,
    baselineRoot,
    editedRoot
  );
  return true;
}

function changedExistingLibraryItemIds(project, fragment) {
  const existingById = new Map();
  for (const item of Array.isArray(project.libraryItems) ? project.libraryItems : []) {
    if (!item?.id) continue;
    const matches = existingById.get(item.id) || [];
    matches.push(item);
    existingById.set(item.id, matches);
  }
  const changed = new Set();
  for (const item of Array.isArray(fragment.libraryItems) ? fragment.libraryItems : []) {
    if (!item?.id) continue;
    const matches = existingById.get(item.id) || [];
    if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(item)) {
      if (matches.length > 0) changed.add(item.id);
    }
  }
  return [...changed].sort();
}

function visitNodeList(nodes, path, visitor) {
  if (!Array.isArray(nodes)) return;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node || typeof node !== 'object') continue;
    visitor({ node, container: nodes, index, field: null, path: `${path}[${index}]` });
    visitNodeChildren(node, `${path}[${index}]`, visitor);
  }
}

function visitNodeChildren(node, path, visitor) {
  for (const field of NODE_LIST_FIELDS) {
    visitNodeList(node[field], `${path}.${field}`, visitor);
  }
  for (const field of NODE_SLOT_FIELDS) {
    const child = node[field];
    if (!child || typeof child !== 'object') continue;
    visitor({ node: child, container: node, index: null, field, path: `${path}.${field}` });
    visitNodeChildren(child, `${path}.${field}`, visitor);
  }
}

export function nodeLocations(project, id, includeLibrary = true) {
  const matches = [];
  for (const [stageIndex, stage] of (project.stages || []).entries()) {
    visitNodeList(stage?.rootNodes, `stages[${stageIndex}].rootNodes`, (location) => {
      if (location.node.id === id) matches.push({ ...location, scope: 'stage', stageIndex });
    });
  }
  if (project.cellTemplate && typeof project.cellTemplate === 'object') {
    const root = project.cellTemplate;
    const rootPath = 'cellTemplate';
    if (root.id === id) {
      matches.push({
        node: root,
        container: project,
        index: null,
        field: 'cellTemplate',
        path: rootPath,
        scope: 'cellTemplate',
      });
    }
    visitNodeChildren(root, rootPath, (location) => {
      if (location.node.id === id) matches.push({ ...location, scope: 'cellTemplate' });
    });
  }
  if (includeLibrary) {
    for (const [itemIndex, item] of (project.libraryItems || []).entries()) {
      if (!item?.rootNode) continue;
      const root = item.rootNode;
      const rootPath = `libraryItems[${itemIndex}].rootNode`;
      if (root.id === id) {
        matches.push({
          node: root,
          container: item,
          index: null,
          field: 'rootNode',
          path: rootPath,
          scope: 'library',
          itemIndex,
        });
      }
      visitNodeChildren(root, rootPath, (location) => {
        if (location.node.id === id) {
          matches.push({ ...location, scope: 'library', itemIndex });
        }
      });
    }
  }
  return matches;
}

function requireUniqueNode(project, id, includeLibrary = true) {
  const matches = nodeLocations(project, id, includeLibrary);
  if (matches.length === 0) throw new Error(`No node with id "${id}" exists in the project.`);
  if (matches.length > 1) {
    throw new Error(
      `Node id "${id}" is ambiguous:\n${matches.map((match) => `  - ${match.path}`).join('\n')}`
    );
  }
  return matches[0];
}

function mergeObject(target, patch, path) {
  if (Array.isArray(patch?.$remove)) {
    for (const key of patch.$remove) {
      if (typeof key !== 'string' || !key || STRUCTURAL_PATCH_FIELDS.has(key)) {
        throw new Error(`Recipe ${path}.$remove contains an invalid or structural field.`);
      }
      delete target[key];
    }
  }
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === '$remove') continue;
    if (STRUCTURAL_PATCH_FIELDS.has(key)) {
      throw new Error(`Recipe ${path}.${key} is structural; use --replace or --append-to.`);
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      mergeObject(target[key], value, `${path}.${key}`);
    } else {
      target[key] = clone(value);
    }
  }
}

function substituteRecipeCaptures(value, captures) {
  if (typeof value === 'string') {
    return value.replace(/\$(\d+)/g, (token, rawIndex) => {
      const index = Number(rawIndex);
      return Number.isInteger(index) && index < captures.length
        ? captures[index] ?? ''
        : token;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteRecipeCaptures(item, captures));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        substituteRecipeCaptures(key, captures),
        substituteRecipeCaptures(item, captures),
      ])
    );
  }
  return value;
}

function allNodeLocations(project) {
  const locations = [];
  for (const [stageIndex, stage] of (project.stages || []).entries()) {
    visitNodeList(stage?.rootNodes, `stages[${stageIndex}].rootNodes`, (location) => {
      locations.push({ ...location, scope: 'stage', stageIndex });
    });
  }
  if (project.cellTemplate && typeof project.cellTemplate === 'object') {
    const rootPath = 'cellTemplate';
    locations.push({
      node: project.cellTemplate,
      container: project,
      index: null,
      field: 'cellTemplate',
      path: rootPath,
      scope: 'cellTemplate',
    });
    visitNodeChildren(project.cellTemplate, rootPath, (location) => {
      locations.push({ ...location, scope: 'cellTemplate' });
    });
  }
  for (const [itemIndex, item] of (project.libraryItems || []).entries()) {
    if (!item?.rootNode) continue;
    const rootPath = `libraryItems[${itemIndex}].rootNode`;
    locations.push({
      node: item.rootNode,
      container: item,
      index: null,
      field: 'rootNode',
      path: rootPath,
      scope: 'library',
      itemIndex,
    });
    visitNodeChildren(item.rootNode, rootPath, (location) => {
      locations.push({ ...location, scope: 'library', itemIndex });
    });
  }
  return locations;
}

/**
 * Attach bindings, state carriers and styleRefs after HTML has supplied visual structure.
 * A recipe cannot add/remove children or change ids; it is intentionally metadata-only.
 *
 * Exact `nodes` entries are best for one-off bindings. `nodePatterns` applies the same
 * metadata-only patch to every generated id matching a regular expression, with `$0`, `$1`, …
 * capture substitution in patch strings. A pattern must match at least one node unless it declares
 * `"optional": true`; this keeps a stale importer id convention from silently producing a
 * half-bound catalog.
 */
export function applyFragmentRecipe(fragment, recipe = {}) {
  const envelope = {
    stages: [{ rootNodes: fragment?.rootNodes || [] }],
    libraryItems: fragment?.libraryItems || [],
  };
  const applied = [];
  for (const [id, patch] of Object.entries(recipe.nodes || {})) {
    const target = requireUniqueNode(envelope, id, true).node;
    mergeObject(target, patch, `nodes.${id}`);
    applied.push(id);
  }
  const locations = allNodeLocations(envelope);
  for (const [index, rule] of (recipe.nodePatterns || []).entries()) {
    if (!rule || typeof rule !== 'object' || typeof rule.match !== 'string' || !rule.match) {
      throw new Error(`Recipe nodePatterns[${index}].match must be a non-empty regular expression.`);
    }
    let matcher;
    try {
      matcher = new RegExp(rule.match);
    } catch (error) {
      throw new Error(`Recipe nodePatterns[${index}].match is invalid: ${error.message}`);
    }
    let matched = 0;
    for (const location of locations) {
      if (!location.node?.id) continue;
      const captures = matcher.exec(location.node.id);
      if (!captures) continue;
      const patch = substituteRecipeCaptures(rule.patch || {}, captures);
      mergeObject(location.node, patch, `nodePatterns[${index}].patch`);
      applied.push(location.node.id);
      matched++;
    }
    if (matched === 0 && rule.optional !== true) {
      throw new Error(
        `Recipe nodePatterns[${index}] matched no imported node ids: ${rule.match}`
      );
    }
  }
  return applied;
}

/**
 * Attach metadata to nodes already present in the destination project as part of
 * the same atomic splice. This lets an imported popover declare its existing
 * authored trigger without teaching the importer about editor-domain behavior.
 */
export function applyProjectRecipe(project, recipe = {}) {
  const applied = [];
  for (const [id, patch] of Object.entries(recipe.projectNodes || {})) {
    const target = requireUniqueNode(project, id, true).node;
    mergeObject(target, patch, `projectNodes.${id}`);
    applied.push(id);
  }
  return applied;
}

function normalizedPaint(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function styleItemKey(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.assetType === 'color') {
    const paint = normalizedPaint(item.assetPath || item.rootNode?.fill);
    return paint ? `color:${paint}` : null;
  }
  if (item.assetType === 'font') {
    const root = item.rootNode || {};
    const family = String(root.fontFamily || '').trim().toLowerCase();
    if (!family) return null;
    return [
      'font',
      family,
      Number(root.fontSize || 0),
      String(root.fontWeight || 'NORMAL').trim().toUpperCase(),
      String(root.fontPosture || 'REGULAR').trim().toUpperCase(),
    ].join(':');
  }
  return null;
}

/**
 * Preserve explicit semantic token ids first, then reuse an existing paint/font artifact only
 * when its typed concrete value has exactly one match. Ambiguity is a hard diagnostic: two
 * semantic roles may intentionally share one paint, so value equality cannot choose for us.
 */
export function canonicalizeImportedStyleItems(project, fragment, tokenMap = {}) {
  const importedItems = Array.isArray(fragment.libraryItems) ? fragment.libraryItems : [];
  const existingItems = Array.isArray(project.libraryItems) ? project.libraryItems : [];
  const existingIds = new Set(existingItems.map((item) => item?.id).filter(Boolean));
  const explicit = new Map(Object.entries(tokenMap || {}));
  const existingByKey = new Map();
  for (const item of existingItems) {
    const key = styleItemKey(item);
    if (!key) continue;
    const matches = existingByKey.get(key) || [];
    matches.push(item.id);
    existingByKey.set(key, matches);
  }

  const remapped = [];
  const ambiguous = [];
  const retained = [];
  for (const item of importedItems) {
    if (!item?.id) {
      retained.push(item);
      continue;
    }
    const sourceId = item.id;
    let destination = explicit.get(sourceId);
    if (destination) {
      if (!existingIds.has(destination)) {
        throw new Error(
          `Recipe tokenMap maps "${sourceId}" to missing Library item "${destination}".`
        );
      }
    } else {
      const key = styleItemKey(item);
      const matches = key ? existingByKey.get(key) || [] : [];
      if (matches.length === 1) destination = matches[0];
      else if (matches.length > 1) {
        ambiguous.push({ importedId: sourceId, candidates: matches });
      }
    }
    if (destination === sourceId) {
      const existing = existingItems.find((candidate) => candidate?.id === sourceId);
      if (existing && styleItemKey(existing) === styleItemKey(item)) {
        remapped.push({ from: sourceId, to: destination });
        continue;
      }
      retained.push(item);
      continue;
    }
    if (!destination) {
      retained.push(item);
      continue;
    }
    replaceReferences(fragment.rootNodes, sourceId, destination);
    replaceReferences(importedItems, sourceId, destination);
    remapped.push({ from: sourceId, to: destination });
  }
  fragment.libraryItems = retained;
  return { remapped, ambiguous };
}

function collectStageIds(project, excludedNode = null) {
  const ids = new Map();
  for (const [stageIndex, stage] of (project.stages || []).entries()) {
    visitNodeList(stage?.rootNodes, `stages[${stageIndex}].rootNodes`, (location) => {
      if (excludedNode && isNodeWithin(location.node, excludedNode)) return;
      if (!location.node.id) return;
      const paths = ids.get(location.node.id) || [];
      paths.push(location.path);
      ids.set(location.node.id, paths);
    });
  }
  if (project.cellTemplate && typeof project.cellTemplate === 'object') {
    const collect = ({ node, path }) => {
      if (excludedNode && isNodeWithin(node, excludedNode)) return;
      if (!node.id) return;
      const paths = ids.get(node.id) || [];
      paths.push(path);
      ids.set(node.id, paths);
    };
    collect({ node: project.cellTemplate, path: 'cellTemplate' });
    visitNodeChildren(project.cellTemplate, 'cellTemplate', collect);
  }
  return ids;
}

function isNodeWithin(candidate, root) {
  if (candidate === root) return true;
  let found = false;
  visitNodeChildren(root, 'root', ({ node }) => {
    if (node === candidate) found = true;
  });
  return found;
}

function assertNoImportedIdCollisions(project, roots, replacedNode) {
  const outside = collectStageIds(project, replacedNode);
  const imported = new Map();
  visitNodeList(roots, 'fragment.rootNodes', ({ node, path }) => {
    if (!node.id) return;
    const paths = imported.get(node.id) || [];
    paths.push(path);
    imported.set(node.id, paths);
  });
  const problems = [];
  for (const [id, paths] of imported) {
    if (paths.length > 1) problems.push(`${id}: repeated in fragment (${paths.join(', ')})`);
    if (outside.has(id)) {
      problems.push(`${id}: collides with ${outside.get(id).join(', ')}`);
    }
  }
  if (problems.length) {
    throw new Error(`Fragment node ids are not safely spliceable:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

function assertGloballyUniqueNodeIds(project) {
  const byId = new Map();
  for (const location of allNodeLocations(project)) {
    const id = location.node?.id;
    if (!id) continue;
    const paths = byId.get(id) || [];
    paths.push(location.path);
    byId.set(id, paths);
  }
  const duplicates = [...byId.entries()].filter(([, paths]) => paths.length > 1);
  if (duplicates.length) {
    throw new Error(
      'Project node ids must be globally unique across stages, the cell template, and Library definitions:\n' +
        duplicates.map(([id, paths]) => `  - ${id}: ${paths.join(', ')}`).join('\n')
    );
  }
}

export function spliceFragment(projectInput, fragmentInput, options = {}) {
  const project = clone(projectInput);
  const fragment = clone(fragmentInput);
  const baselineFragment = options.baselineFragment ? clone(options.baselineFragment) : null;
  validateProjectStructure(project);
  if (!Array.isArray(fragment?.rootNodes) || fragment.rootNodes.length === 0) {
    throw new Error('Fragment must contain at least one root node.');
  }
  if (Boolean(options.replace) === Boolean(options.appendTo)) {
    throw new Error('Choose exactly one splice operation: replace or appendTo.');
  }

  const recipe = options.recipe || {};
  const recipeNodes = applyFragmentRecipe(fragment, recipe);
  const projectRecipeNodes = applyProjectRecipe(project, recipe);
  const tokenResult = canonicalizeImportedStyleItems(project, fragment, recipe.tokenMap);
  if (tokenResult.ambiguous.length) {
    throw new Error(
      'Imported style values match multiple Library roles; add explicit recipe.tokenMap entries:\n' +
        tokenResult.ambiguous
          .map((entry) => `  - ${entry.importedId}: ${entry.candidates.join(', ')}`)
          .join('\n')
    );
  }

  if (baselineFragment) {
    const baselineTokenResult = canonicalizeImportedStyleItems(
      project, baselineFragment, recipe.tokenMap
    );
    if (baselineTokenResult.ambiguous.length) {
      throw new Error(
        'The no-op fragment baseline has ambiguous Library style roles; add explicit recipe.tokenMap entries:\n' +
          baselineTokenResult.ambiguous
            .map((entry) => `  - ${entry.importedId}: ${entry.candidates.join(', ')}`)
            .join('\n')
      );
    }
  }

  const targetId = options.replace || options.appendTo;
  const target = requireUniqueNode(project, targetId, true);
  if (target.scope === 'library' && !options.updateSharedLibrary) {
    throw new Error(
      `Direct Library target "${targetId}" requires updateSharedLibrary and a complete no-op baseline.`
    );
  }
  const targetLibraryItemId = options.updateSharedLibrary
    ? target.scope === 'library'
      ? project.libraryItems?.[target.itemIndex]?.id || null
      : target.node.libraryItemId || null
    : undefined;
  const changedSharedItems = options.updateSharedLibrary
    ? changedExistingLibraryItemIds(project, fragment)
    : [];
  if (options.updateSharedLibrary && !targetLibraryItemId && changedSharedItems.length) {
    throw new Error(
      'Shared Library mutation requires a shared replacement target and complete no-op baseline; ' +
        `would update: ${changedSharedItems.join(', ')}.`
    );
  }
  if (targetLibraryItemId && !options.replace) {
    throw new Error(
      `Shared Library target "${targetLibraryItemId}" supports replace only; ` +
        'append cannot produce a complete authored-delta baseline.'
    );
  }
  if (targetLibraryItemId && !baselineFragment) {
    throw new Error(
      `Shared Library target "${targetLibraryItemId}" requires a complete no-op baseline.`
    );
  }
  if (options.replace && fragment.rootNodes.length === 1 && target.node.id) {
    const importedId = fragment.rootNodes[0].id;
    if (importedId && importedId !== target.node.id) {
      for (const root of fragment.rootNodes) {
        remapTypedNodeReferences(root, importedId, target.node.id);
      }
      for (const item of fragment.libraryItems || []) {
        remapTypedNodeReferences(item?.rootNode, importedId, target.node.id);
      }
    }
    fragment.rootNodes[0].id = target.node.id;
  }
  const sharedAuthoredDeltaApplied = applySharedTargetAuthoredDelta(
    project, target.node, fragment, baselineFragment, targetLibraryItemId
  );
  const nonLibraryAuthoredDeltaApplied = applyNonLibraryTargetAuthoredDelta(
    target.node, fragment, baselineFragment, targetLibraryItemId
  );
  const authoredDeltaBaselineApplied =
    sharedAuthoredDeltaApplied || nonLibraryAuthoredDeltaApplied;
  assertNoImportedIdCollisions(project, fragment.rootNodes, options.replace ? target.node : null);

  const library = mergeLibraryItems(
    project,
    fragment.libraryItems || [],
    fragment.rootNodes,
    Boolean(options.updateSharedLibrary),
    targetLibraryItemId
  );
  project.libraryItems = library.libraryItems;
  if (Array.isArray(fragment.embeddedFontFaces) && fragment.embeddedFontFaces.length) {
    const existing = Array.isArray(project.embeddedFontFaces) ? project.embeddedFontFaces : [];
    const seen = new Set(existing.map((face) => JSON.stringify(face)));
    project.embeddedFontFaces = [...existing];
    for (const face of fragment.embeddedFontFaces) {
      const key = JSON.stringify(face);
      if (!seen.has(key)) {
        seen.add(key);
        project.embeddedFontFaces.push(face);
      }
    }
  }

  if (options.replace) {
    if (target.field) {
      if (fragment.rootNodes.length !== 1) {
        throw new Error(`${target.path} is a single-node slot and requires exactly one fragment root.`);
      }
      target.container[target.field] = fragment.rootNodes[0];
    } else {
      target.container.splice(target.index, 1, ...fragment.rootNodes);
    }
  } else {
    if (!Array.isArray(target.node.children)) target.node.children = [];
    target.node.children.push(...fragment.rootNodes);
  }

  assertGloballyUniqueNodeIds(project);
  validateProjectStructure(project);
  return {
    project,
    report: {
      operation: options.replace ? 'replace' : 'append',
      targetId,
      rootNodeCount: fragment.rootNodes.length,
      recipeNodes,
      projectRecipeNodes,
      canonicalStyleRemaps: tokenResult.remapped,
      collidingLibraryRemaps: library.remapped,
      authoredDeltaBaselineApplied,
    },
  };
}
