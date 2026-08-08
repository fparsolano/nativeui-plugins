import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeImportedStyleItems,
  spliceFragment,
} from '../lib/fragment-splice.mjs';
import { mergeLibraryItems } from '../lib/project-update.mjs';
import {
  countNodes,
  parseArgs,
  resolveNoOpBaselineTarget,
} from '../bin/nui-fragment-import.mjs';

function projectFixture() {
  return {
    version: 3,
    stages: [
      {
        stageId: 'editor',
        name: 'Editor',
        rootNodes: [
          {
            kind: 'javafx.scene.layout.VBox',
            id: 'panel',
            children: [
              { kind: 'javafx.scene.control.Label', id: 'old_label', text: 'Old', children: [] },
            ],
          },
          { kind: 'javafx.scene.control.Label', id: 'untouched', text: 'Keep', children: [] },
        ],
      },
    ],
    libraryItems: [
      {
        id: 'editor-color-accent',
        name: 'Accent',
        assetType: 'color',
        assetPath: '#0096c9@1.000',
        rootNode: {
          kind: 'javafx.scene.shape.Rectangle',
          id: 'editor_color_accent_swatch',
          fill: '#0096c9@1.000',
          children: [],
        },
      },
    ],
  };
}

test('fragment replacement is atomic-model shaped, preserves target id, attaches recipe and tokens', () => {
  const fragment = {
    rootNodes: [
      {
        kind: 'javafx.scene.layout.VBox',
        id: 'html_panel',
        children: [
          {
            kind: 'javafx.scene.control.Button',
            id: 'apply_button',
            text: 'Apply',
            backgroundFillLibraryItemId: 'imported-accent',
            children: [],
          },
        ],
      },
    ],
    libraryItems: [
      {
        id: 'imported-accent',
        name: 'Imported accent',
        assetType: 'color',
        assetPath: '#0096c9@1.000',
        rootNode: {
          kind: 'javafx.scene.shape.Rectangle',
          id: 'imported_accent_swatch',
          fill: '#0096c9@1.000',
          children: [],
        },
      },
    ],
  };

  const result = spliceFragment(projectFixture(), fragment, {
    replace: 'panel',
    recipe: {
      nodes: {
        apply_button: {
          styleRefs: { backgroundFill: 'editor-color-accent' },
          parentLayoutProps: {
            'nui.visibleWhen': 'workbench.can_apply',
            'nui.actionId': 'apply_panel',
          },
        },
      },
    },
  });

  const panel = result.project.stages[0].rootNodes[0];
  assert.equal(panel.id, 'panel', 'replacement keeps the model target identity');
  assert.equal(result.project.stages[0].rootNodes[1].text, 'Keep');
  const button = panel.children[0];
  assert.deepEqual(button.styleRefs, { backgroundFill: 'editor-color-accent' });
  assert.equal(button.parentLayoutProps['nui.actionId'], 'apply_panel');
  assert.equal(button.backgroundFillLibraryItemId, 'editor-color-accent');
  assert.equal(result.project.libraryItems.length, 1, 'concrete duplicate paint is not added');
  assert.deepEqual(result.report.canonicalStyleRemaps, [
    { from: 'imported-accent', to: 'editor-color-accent' },
  ]);
});

test('replacement root identity remaps every typed node carrier without rewriting opaque values', () => {
  const importedRootId = 'html_panel';
  const fragment = {
    rootNodes: [
      {
        kind: 'javafx.scene.layout.VBox',
        id: importedRootId,
        text: importedRootId,
        imageUrl: importedRootId,
        parameterValues: { label: importedRootId },
        form: {
          action: importedRootId,
          target: importedRootId,
          hiddenValues: { source: importedRootId },
        },
        formControl: {
          formId: importedRootId,
          formAction: importedRootId,
          value: importedRootId,
        },
        nodeRefId: importedRootId,
        nodeRefProps: { labelFor: importedRootId },
        repeater: { repeaterId: importedRootId, dataSource: importedRootId },
        bindings: [{ repeaterId: importedRootId, path: importedRootId }],
        repeaterInstance: {
          repeaterId: importedRootId,
          templateNodeId: importedRootId,
          dataSource: importedRootId,
        },
        interactions: [
          {
            targetNodeId: importedRootId,
            params: { valueNodeId: importedRootId, handler: importedRootId },
          },
        ],
        interactionSpecs: [
          {
            action: {
              targetNodeId: importedRootId,
              formNodeId: importedRootId,
              url: importedRootId,
              parameters: { email: importedRootId },
            },
          },
        ],
        eventBindings: {
          submit: {
            targetNodeId: importedRootId,
            params: { formId: importedRootId, handler: importedRootId },
          },
        },
        children: [],
      },
    ],
    libraryItems: [
      {
        id: 'new-component',
        assetType: 'node',
        rootNode: {
          id: 'new-component-root',
          kind: 'javafx.scene.control.Label',
          text: importedRootId,
          nodeRefId: importedRootId,
          repeater: { repeaterId: importedRootId, dataSource: importedRootId },
          children: [],
        },
      },
    ],
  };

  const result = spliceFragment(projectFixture(), fragment, { replace: 'panel' });
  const root = result.project.stages[0].rootNodes[0];
  assert.equal(root.id, 'panel');
  assert.equal(root.nodeRefId, 'panel');
  assert.equal(root.nodeRefProps.labelFor, 'panel');
  assert.equal(root.formControl.formId, 'panel');
  assert.equal(root.repeater.repeaterId, 'panel');
  assert.equal(root.bindings[0].repeaterId, 'panel');
  assert.equal(root.repeaterInstance.repeaterId, 'panel');
  assert.equal(root.repeaterInstance.templateNodeId, 'panel');
  assert.equal(root.interactions[0].targetNodeId, 'panel');
  assert.equal(root.interactions[0].params.valueNodeId, 'panel');
  assert.equal(root.interactionSpecs[0].action.targetNodeId, 'panel');
  assert.equal(root.interactionSpecs[0].action.formNodeId, 'panel');
  assert.equal(root.eventBindings.submit.targetNodeId, 'panel');
  assert.equal(root.eventBindings.submit.params.formId, 'panel');
  assert.equal(root.text, importedRootId);
  assert.equal(root.imageUrl, importedRootId);
  assert.equal(root.parameterValues.label, importedRootId);
  assert.equal(root.form.action, importedRootId);
  assert.equal(root.form.target, importedRootId);
  assert.equal(root.form.hiddenValues.source, importedRootId);
  assert.equal(root.formControl.formAction, importedRootId);
  assert.equal(root.formControl.value, importedRootId);
  assert.equal(root.repeater.dataSource, importedRootId);
  assert.equal(root.bindings[0].path, importedRootId);
  assert.equal(root.repeaterInstance.dataSource, importedRootId);
  assert.equal(root.interactions[0].params.handler, importedRootId);
  assert.equal(root.interactionSpecs[0].action.url, importedRootId);
  assert.equal(root.interactionSpecs[0].action.parameters.email, importedRootId);
  assert.equal(root.eventBindings.submit.params.handler, importedRootId);

  const libraryRoot = result.project.libraryItems
    .find((item) => item.id === 'new-component').rootNode;
  assert.equal(libraryRoot.nodeRefId, 'panel');
  assert.equal(libraryRoot.repeater.repeaterId, 'panel');
  assert.equal(libraryRoot.text, importedRootId);
  assert.equal(libraryRoot.repeater.dataSource, importedRootId);
});

test('fragment append rejects duplicate node ids and otherwise appends without replacing parent', () => {
  assert.throws(
    () =>
      spliceFragment(
        projectFixture(),
        {
          rootNodes: [
            { kind: 'javafx.scene.control.Label', id: 'untouched', text: 'Collision', children: [] },
          ],
          libraryItems: [],
        },
        { appendTo: 'panel' }
      ),
    /collides with/
  );

  const result = spliceFragment(
    projectFixture(),
    {
      rootNodes: [
        { kind: 'javafx.scene.control.Label', id: 'new_label', text: 'New', children: [] },
      ],
      libraryItems: [],
    },
    { appendTo: 'panel' }
  );
  assert.deepEqual(
    result.project.stages[0].rootNodes[0].children.map((node) => node.id),
    ['old_label', 'new_label']
  );
});

test('top-level cell template nodes participate in lookup and fragment collision checks', () => {
  const project = projectFixture();
  project.cellTemplate = {
    kind: 'javafx.scene.layout.VBox',
    id: 'cell_template',
    children: [
      { kind: 'javafx.scene.control.Label', id: 'cell_label', text: 'Old cell', children: [] },
    ],
  };

  assert.throws(
    () =>
      spliceFragment(
        project,
        {
          rootNodes: [
            { kind: 'javafx.scene.control.Label', id: 'cell_label', text: 'Collision', children: [] },
          ],
          libraryItems: [],
        },
        { appendTo: 'panel' }
      ),
    /collides with cellTemplate\.children\[0\]/
  );

  const replaced = spliceFragment(
    project,
    {
      rootNodes: [
        { kind: 'javafx.scene.control.Label', id: 'html_cell_label', text: 'Updated cell', children: [] },
      ],
      libraryItems: [],
    },
    { replace: 'cell_label' }
  );
  assert.equal(replaced.project.cellTemplate.children[0].id, 'cell_label');
  assert.equal(replaced.project.cellTemplate.children[0].text, 'Updated cell');
});

test('fragment append can bind an existing authored trigger in the same atomic splice', () => {
  const result = spliceFragment(
    projectFixture(),
    {
      rootNodes: [
        { kind: 'javafx.scene.layout.VBox', id: 'new_popover', children: [] },
      ],
      libraryItems: [],
    },
    {
      appendTo: 'panel',
      recipe: {
        projectNodes: {
          untouched: {
            parentLayoutProps: {
              'nui.popoverTarget': 'new_popover',
            },
          },
        },
      },
    }
  );

  assert.equal(
    result.project.stages[0].rootNodes[1].parentLayoutProps['nui.popoverTarget'],
    'new_popover'
  );
  assert.deepEqual(result.report.projectRecipeNodes, ['untouched']);
});

test('project recipe remains metadata-only', () => {
  assert.throws(
    () =>
      spliceFragment(
        projectFixture(),
        {
          rootNodes: [
            { kind: 'javafx.scene.layout.VBox', id: 'new_popover', children: [] },
          ],
          libraryItems: [],
        },
        {
          appendTo: 'panel',
          recipe: {
            projectNodes: {
              untouched: {
                children: [],
              },
            },
          },
        }
      ),
    /structural/
  );
});

test('recipe metadata can explicitly retire a stale non-structural field', () => {
  const project = projectFixture();
  project.stages[0].rootNodes[1].parentLayoutProps = {
    'nui.popoverTarget': 'old_popover',
    'nui.keep': 'yes',
  };
  const result = spliceFragment(
    project,
    {
      rootNodes: [{ kind: 'javafx.scene.layout.VBox', id: 'new_popover', children: [] }],
      libraryItems: [],
    },
    {
      appendTo: 'panel',
      recipe: {
        projectNodes: {
          untouched: {
            parentLayoutProps: {
              $remove: ['nui.popoverTarget'],
              'nui.modalTarget': 'new_popover',
            },
          },
        },
      },
    }
  );

  assert.deepEqual(result.project.stages[0].rootNodes[1].parentLayoutProps, {
    'nui.keep': 'yes',
    'nui.modalTarget': 'new_popover',
  });
  assert.throws(
    () =>
      spliceFragment(
        projectFixture(),
        {
          rootNodes: [
            { kind: 'javafx.scene.layout.VBox', id: 'new_popover', children: [] },
          ],
          libraryItems: [],
        },
        {
          appendTo: 'panel',
          recipe: { projectNodes: { untouched: { $remove: ['children'] } } },
        }
      ),
    /structural/
  );
});

test('fragment recipe node patterns bind generated catalogs with capture substitution', () => {
  const fragment = {
    rootNodes: [
      {
        kind: 'javafx.scene.layout.Pane',
        id: 'property_panel_button',
        children: [],
      },
    ],
    libraryItems: [
      {
        id: 'lib-panel-button',
        assetType: 'node',
        rootNode: {
          kind: 'javafx.scene.layout.Pane',
          id: 'lib_property_panel_button',
          children: [],
        },
      },
    ],
  };

  const result = spliceFragment(projectFixture(), fragment, {
    appendTo: 'panel',
    recipe: {
      nodePatterns: [
        {
          match: '^(?:property_panel|lib_property_panel)_([a-z]+)$',
          patch: {
            parentLayoutProps: {
              'nui.propertyGridRole': 'panel-$1',
              'nui.sourceId': '$0',
            },
          },
        },
      ],
    },
    updateSharedLibrary: true,
  });

  const shell = result.project.stages[0].rootNodes[0].children.at(-1);
  assert.equal(shell.parentLayoutProps['nui.propertyGridRole'], 'panel-button');
  assert.equal(shell.parentLayoutProps['nui.sourceId'], 'property_panel_button');
  const libraryRoot = result.project.libraryItems.find((item) => item.id === 'lib-panel-button')
    .rootNode;
  assert.equal(libraryRoot.parentLayoutProps['nui.propertyGridRole'], 'panel-button');
  assert.ok(result.report.recipeNodes.includes('property_panel_button'));
  assert.ok(result.report.recipeNodes.includes('lib_property_panel_button'));
});

test('fragment recipe node patterns fail closed unless explicitly optional', () => {
  const fragment = {
    rootNodes: [
      { kind: 'javafx.scene.layout.Pane', id: 'new_panel', children: [] },
    ],
    libraryItems: [],
  };
  assert.throws(
    () =>
      spliceFragment(projectFixture(), fragment, {
        appendTo: 'panel',
        recipe: {
          nodePatterns: [{ match: '^missing_', patch: { opacity: 0.5 } }],
        },
      }),
    /matched no imported node ids/
  );

  assert.doesNotThrow(() =>
    spliceFragment(projectFixture(), fragment, {
      appendTo: 'panel',
      recipe: {
        nodePatterns: [{ match: '^missing_', patch: { opacity: 0.5 }, optional: true }],
      },
    })
  );
});

test('shared Library replacement preserves the destination template root id', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'shared-widget',
    name: 'Shared Widget',
    assetType: 'node',
    rootNode: { id: 'legacy-stable-root', kind: 'javafx.scene.layout.Pane', children: [] },
  });
  const imported = {
    id: 'shared-widget',
    name: 'Shared Widget',
    assetType: 'node',
    rootNode: {
      id: 'shared-widget_root',
      kind: 'javafx.scene.layout.Pane',
      text: 'Updated',
      imageUrl: 'shared-widget_root',
      parameterValues: { label: 'shared-widget_root' },
      form: {
        action: 'shared-widget_root',
        target: 'shared-widget_root',
        hiddenValues: { source: 'shared-widget_root' },
      },
      formControl: {
        formId: 'shared-widget_root',
        formAction: 'shared-widget_root',
        formTarget: 'shared-widget_root',
        value: 'shared-widget_root',
      },
      nodeRefId: 'shared-widget_root',
      nodeRefProps: { labelFor: 'shared-widget_root' },
      interactions: [
        {
          targetNodeId: 'shared-widget_root',
          params: {
            targetNodeId: 'shared-widget_root',
            formId: 'shared-widget_root',
            url: 'shared-widget_root',
            formValue: 'shared-widget_root',
          },
        },
      ],
      interactionSpecs: [
        {
          action: {
            targetNodeId: 'shared-widget_root',
            formNodeId: 'shared-widget_root',
            url: 'shared-widget_root',
            targetLibraryItemId: 'shared-widget_root',
            parameters: { email: 'shared-widget_root' },
          },
        },
      ],
      eventBindings: {
        submit: {
          targetNodeId: 'shared-widget_root',
          params: {
            valueNodeId: 'shared-widget_root',
            handler: 'shared-widget_root',
          },
        },
      },
      children: [
        {
          id: 'shared-widget_child',
          kind: 'javafx.scene.control.Label',
          text: 'shared-widget_root',
          nodeRefId: 'shared-widget_root',
          children: [],
        },
      ],
    },
  };

  const merged = mergeLibraryItems(project, [imported], [], true, 'shared-widget');

  const updated = merged.libraryItems.find((item) => item.id === 'shared-widget');
  assert.equal(updated.rootNode.id, 'legacy-stable-root');
  assert.equal(updated.rootNode.text, 'Updated');
  assert.equal(updated.rootNode.imageUrl, 'shared-widget_root');
  assert.equal(updated.rootNode.parameterValues.label, 'shared-widget_root');
  assert.equal(updated.rootNode.form.action, 'shared-widget_root');
  assert.equal(updated.rootNode.form.target, 'shared-widget_root');
  assert.equal(updated.rootNode.form.hiddenValues.source, 'shared-widget_root');
  assert.equal(updated.rootNode.formControl.formId, 'legacy-stable-root');
  assert.equal(updated.rootNode.formControl.formAction, 'shared-widget_root');
  assert.equal(updated.rootNode.formControl.formTarget, 'shared-widget_root');
  assert.equal(updated.rootNode.formControl.value, 'shared-widget_root');
  assert.equal(updated.rootNode.nodeRefId, 'legacy-stable-root');
  assert.equal(updated.rootNode.nodeRefProps.labelFor, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactions[0].targetNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactions[0].params.targetNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactions[0].params.formId, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactions[0].params.url, 'shared-widget_root');
  assert.equal(updated.rootNode.interactions[0].params.formValue, 'shared-widget_root');
  assert.equal(updated.rootNode.interactionSpecs[0].action.targetNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactionSpecs[0].action.formNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.interactionSpecs[0].action.url, 'shared-widget_root');
  assert.equal(updated.rootNode.interactionSpecs[0].action.targetLibraryItemId, 'shared-widget_root');
  assert.equal(updated.rootNode.interactionSpecs[0].action.parameters.email, 'shared-widget_root');
  assert.equal(updated.rootNode.eventBindings.submit.targetNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.eventBindings.submit.params.valueNodeId, 'legacy-stable-root');
  assert.equal(updated.rootNode.eventBindings.submit.params.handler, 'shared-widget_root');
  assert.equal(updated.rootNode.children[0].text, 'shared-widget_root');
  assert.equal(updated.rootNode.children[0].nodeRefId, 'legacy-stable-root');
});

test('shared Library edit applies only the authored importer delta over the canonical item', () => {
  const project = projectFixture();
  project.stages[0].rootNodes[0] = {
    id: 'panel',
    kind: 'javafx.scene.layout.VBox',
    libraryItemId: 'panel-component',
    libraryReference: true,
    prefHeight: 1,
    children: [],
  };
  project.libraryItems.push({
    id: 'panel-component',
    name: 'Panel',
    assetType: 'node',
    rootNode: {
      id: 'panel-component_root',
      kind: 'javafx.scene.layout.VBox',
      width: 331,
      height: 946,
      maxHeight: -1,
      children: [
        {
          id: 'panel-label',
          kind: 'javafx.scene.control.Label',
          layoutY: 862,
          text: 'Before',
          children: [],
        },
      ],
    },
  });
  const baselineFragment = {
    rootNodes: [
      {
        id: 'panel',
        kind: 'javafx.scene.layout.VBox',
        libraryItemId: 'panel-component',
        libraryReference: true,
        prefHeight: 946,
        children: [],
      },
    ],
    libraryItems: [
      {
        id: 'panel-component',
        name: 'Panel',
        assetType: 'node',
        rootNode: {
          id: 'panel-component_root',
          kind: 'javafx.scene.layout.VBox',
          width: 331,
          height: 946,
          maxHeight: 946,
          children: [
            {
              id: 'panel-label',
              kind: 'javafx.scene.control.Label',
              layoutY: 0,
              text: 'Before',
              children: [],
            },
          ],
        },
      },
    ],
  };
  const editedFragment = structuredClone(baselineFragment);
  editedFragment.libraryItems[0].rootNode.width = 350;
  editedFragment.libraryItems[0].rootNode.children[0].text = 'After';

  const result = spliceFragment(project, editedFragment, {
    replace: 'panel',
    updateSharedLibrary: true,
    baselineFragment,
  });
  const updated = result.project.libraryItems.find((item) => item.id === 'panel-component');

  assert.equal(updated.rootNode.width, 350, 'the explicit HTML width edit is applied');
  assert.equal(updated.rootNode.height, 946, 'an unchanged authored value remains canonical');
  assert.equal(updated.rootNode.maxHeight, -1, 'an importer-only default cannot overwrite canonical state');
  assert.equal(updated.rootNode.children[0].layoutY, 862, 'lossy no-op layout is ignored');
  assert.equal(updated.rootNode.children[0].text, 'After', 'the explicit content edit is applied');
  assert.equal(
    result.project.stages[0].rootNodes[0].prefHeight,
    1,
    'the materialized authoring root cannot overwrite the canonical occurrence shell'
  );
  assert.equal(result.report.authoredDeltaBaselineApplied, true);
});

test('reapplying an authored shared Library delta reconciles synthetic baseline wrappers by node id', () => {
  const project = projectFixture();
  const thinOccurrence = {
    id: 'property_panel_accordion',
    kind: 'javafx.scene.layout.VBox',
    libraryItemId: 'panel-component',
    libraryReference: true,
    prefHeight: 1,
    minHeight: 1,
    children: [],
  };
  const canonicalChildren = [
    {
      id: 'accordion_base',
      kind: 'javafx.scene.layout.Pane',
      libraryItemId: 'panel-base',
      libraryReference: true,
      children: [],
    },
    {
      id: 'accordion_section',
      kind: 'javafx.scene.layout.AnchorPane',
      layoutY: 862,
      children: [
        {
          id: 'accordion_section_label',
          kind: 'javafx.scene.control.Label',
          text: 'ACCORDION',
          children: [],
        },
      ],
    },
    {
      id: 'accordion_vgap',
      kind: 'javafx.scene.layout.AnchorPane',
      libraryItemId: 'number-row',
      libraryReference: true,
      parameterValues: { label: 'V Gap' },
      children: [],
    },
  ];
  const importedChildren = structuredClone(canonicalChildren);
  importedChildren[1].layoutY = 0;
  const panelItem = (children) => ({
    id: 'panel-component',
    name: 'Property Panel — Accordion',
    assetType: 'node',
    rootNode: {
      id: 'panel-component_root',
      kind: 'javafx.scene.layout.VBox',
      prefHeight: 916,
      children,
    },
  });
  const materializedOccurrence = {
    ...thinOccurrence,
    prefHeight: 916,
    minHeight: 916,
  };
  project.stages[0].rootNodes[0] = thinOccurrence;
  project.libraryItems.push(panelItem(canonicalChildren));

  // Exporting the already-converted VBox and importing that no-op HTML introduces an importer
  // flow wrapper. The authored HTML imports the same stable nodes as direct children.
  const baselineFragment = {
    rootNodes: [materializedOccurrence],
    libraryItems: [
      panelItem([
        {
          id: 'nui_flow',
          kind: 'javafx.scene.layout.VBox',
          children: structuredClone(importedChildren.slice(1)),
        },
        structuredClone(importedChildren[0]),
      ]),
    ],
  };
  const editedFragment = {
    rootNodes: [materializedOccurrence],
    libraryItems: [panelItem(importedChildren)],
  };

  const result = spliceFragment(project, editedFragment, {
    replace: 'property_panel_accordion',
    updateSharedLibrary: true,
    baselineFragment,
  });
  const occurrence = result.project.stages[0].rootNodes[0];
  const updated = result.project.libraryItems.find((item) => item.id === 'panel-component');

  assert.equal(occurrence.prefHeight, 1, 'the thin occurrence shell keeps canonical geometry');
  assert.equal(occurrence.minHeight, 1, 'materialized HTML cannot expand the occurrence shell');
  assert.deepEqual(
    updated.rootNode.children.map((node) => node.id),
    ['accordion_base', 'accordion_section', 'accordion_vgap'],
    'stable nodes are reconciled across the synthetic importer wrapper rather than duplicated'
  );
  assert.equal(
    updated.rootNode.children[1].layoutY,
    862,
    'an unchanged lossy baseline projection cannot overwrite canonical node state'
  );
  assert.deepEqual(
    result.project,
    project,
    'reapplying identical authored content leaves the canonical project unchanged'
  );
});

test('a recipe patch inside an unchanged synthetic wrapper updates canonical siblings without sparse nodes', () => {
  const project = projectFixture();
  const occurrence = {
    id: 'property_panel_menubutton',
    kind: 'javafx.scene.layout.VBox',
    libraryItemId: 'panel-component',
    libraryReference: true,
    height: 1,
    children: [],
  };
  const canonicalChildren = [
    {
      id: 'menubutton_base',
      kind: 'javafx.scene.layout.Pane',
      libraryItemId: 'panel-base',
      libraryReference: true,
      children: [],
    },
    {
      id: 'menubutton_section',
      kind: 'javafx.scene.layout.AnchorPane',
      backgroundFillLibraryItemId: 'editor-color-band',
      styleRefs: { backgroundFill: 'editor-color-band' },
      children: [],
    },
    {
      id: 'menubutton_popup_side',
      kind: 'javafx.scene.layout.VBox',
      children: [],
    },
  ];
  const panelItem = (children) => ({
    id: 'panel-component',
    name: 'Property Panel — MenuButton',
    assetType: 'node',
    rootNode: {
      id: 'panel-component_root',
      kind: 'javafx.scene.layout.VBox',
      children,
    },
  });
  project.stages[0].rootNodes[0] = occurrence;
  project.libraryItems.push(panelItem(canonicalChildren));

  const projectedSection = {
    id: 'menubutton_section',
    kind: 'javafx.scene.layout.AnchorPane',
    children: [],
  };
  const projectedRow = {
    id: 'menubutton_popup_side',
    kind: 'javafx.scene.layout.VBox',
    children: [],
  };
  const baselineFragment = {
    rootNodes: [structuredClone(occurrence)],
    libraryItems: [panelItem([
      {
        id: 'nui_flow',
        kind: 'javafx.scene.layout.VBox',
        children: [projectedSection, projectedRow],
      },
      structuredClone(canonicalChildren[0]),
    ])],
  };
  const editedFragment = structuredClone(baselineFragment);
  const editedSection = editedFragment.libraryItems[0].rootNode.children[0].children[0];
  editedSection.backgroundFillLibraryItemId = 'editor-color-band';
  editedSection.styleRefs = { backgroundFill: 'editor-color-band' };

  const result = spliceFragment(project, editedFragment, {
    replace: occurrence.id,
    updateSharedLibrary: true,
    baselineFragment,
  });
  const updated = result.project.libraryItems.find((item) => item.id === 'panel-component');

  assert.deepEqual(
    updated.rootNode.children.map((node) => node.id),
    ['menubutton_base', 'menubutton_section', 'menubutton_popup_side'],
    'the synthetic flow wrapper is not promoted into the canonical Library definition'
  );
  assert.equal(updated.rootNode.children.every((node) => node && node.id), true);
  assert.deepEqual(result.project, project, 'restoring existing recipe metadata is a byte-no-op');
});

test('non-Library replacement applies only the authored HTML delta over canonical state', () => {
  const project = projectFixture();
  project.stages[0].rootNodes[0] = {
    id: 'menubar',
    kind: 'javafx.scene.control.MenuBar',
    width: 300,
    height: 30,
    menuBar: { useSystemMenuBar: false },
    parentLayoutProps: { 'nui.unprojectedRuntimeIntent': 'preserve' },
    children: [
      { id: 'file-menu', kind: 'javafx.scene.control.Menu', text: 'File', children: [] },
      { id: 'edit-menu', kind: 'javafx.scene.control.Menu', text: 'Edit', children: [] },
    ],
  };
  const baselineFragment = {
    rootNodes: [
      {
        id: 'menubar',
        kind: 'javafx.scene.control.MenuBar',
        width: 300,
        height: 30,
        menuBar: { useSystemMenuBar: false },
        children: [],
      },
    ],
    libraryItems: [],
  };
  const editedFragment = structuredClone(baselineFragment);
  editedFragment.rootNodes[0].menuBar.useSystemMenuBar = true;

  const result = spliceFragment(project, editedFragment, {
    replace: 'menubar',
    baselineFragment,
  });
  const updated = result.project.stages[0].rootNodes[0];

  assert.equal(updated.menuBar.useSystemMenuBar, true, 'the authored typed edit is applied');
  assert.deepEqual(
    updated.children.map((node) => node.id),
    ['file-menu', 'edit-menu'],
    'children absent from the HTML projection are not erased'
  );
  assert.equal(
    updated.parentLayoutProps['nui.unprojectedRuntimeIntent'],
    'preserve',
    'canonical fields absent from both projections survive the splice'
  );
  assert.equal(result.report.authoredDeltaBaselineApplied, true);
});

test('non-Library authored delta fails closed on incomplete root projections', () => {
  const project = projectFixture();
  const editedFragment = {
    rootNodes: [{ id: 'edited-panel', kind: 'javafx.scene.layout.VBox', children: [] }],
    libraryItems: [],
  };

  assert.throws(
    () =>
      spliceFragment(project, editedFragment, {
        replace: 'panel',
        baselineFragment: { rootNodes: [], libraryItems: [] },
      }),
    /Non-Library authored-delta splice requires exactly one baseline root; found 0/
  );
});

test('shared Library authored delta fails closed when any target projection is absent or duplicated', () => {
  const project = projectFixture();
  project.stages[0].rootNodes[0] = {
    id: 'panel',
    kind: 'javafx.scene.layout.VBox',
    libraryItemId: 'panel-component',
    libraryReference: true,
    children: [],
  };
  const targetItem = {
    id: 'panel-component',
    name: 'Panel',
    assetType: 'node',
    rootNode: { id: 'panel-component_root', kind: 'javafx.scene.layout.VBox', children: [] },
  };
  project.libraryItems.push(targetItem);
  const baselineFragment = {
    rootNodes: [structuredClone(project.stages[0].rootNodes[0])],
    libraryItems: [structuredClone(targetItem)],
  };
  const editedFragment = structuredClone(baselineFragment);

  assert.throws(
    () =>
      spliceFragment(project, editedFragment, {
        replace: 'panel',
        updateSharedLibrary: true,
      }),
    /Shared Library target "panel-component" requires a complete no-op baseline/
  );

  assert.throws(
    () =>
      spliceFragment(project, editedFragment, {
        appendTo: 'panel',
        updateSharedLibrary: true,
        baselineFragment,
      }),
    /Shared Library target "panel-component" supports replace only/
  );

  const cases = [
    {
      label: 'existing project',
      mutate(existing) {
        existing.libraryItems = existing.libraryItems.filter((item) => item.id !== targetItem.id);
      },
    },
    {
      label: 'baseline',
      mutate(_existing, baseline) {
        baseline.libraryItems = [];
      },
    },
    {
      label: 'edited fragment',
      mutate(_existing, _baseline, edited) {
        edited.libraryItems.push(structuredClone(targetItem));
      },
      found: 2,
    },
    {
      label: 'baseline root',
      mutate(_existing, baseline) {
        baseline.rootNodes = [];
      },
      expected: /requires exactly one baseline root; found 0/,
    },
    {
      label: 'edited fragment root',
      mutate(_existing, _baseline, edited) {
        edited.rootNodes.push(structuredClone(edited.rootNodes[0]));
      },
      expected: /requires exactly one edited fragment root; found 2/,
    },
  ];

  for (const scenario of cases) {
    const existing = structuredClone(project);
    const baseline = structuredClone(baselineFragment);
    const edited = structuredClone(editedFragment);
    scenario.mutate(existing, baseline, edited);
    assert.throws(
      () =>
        spliceFragment(existing, edited, {
          replace: 'panel',
          updateSharedLibrary: true,
          baselineFragment: baseline,
        }),
      scenario.expected || new RegExp(
        `requires exactly one ${scenario.label} target item "panel-component"; found ` +
          `${scenario.found || 0}`
      ),
      scenario.label
    );
  }
});

test('shared mutation without a resolvable shared target cannot bypass the baseline contract', () => {
  const project = projectFixture();
  const changedPaint = structuredClone(project.libraryItems[0]);
  changedPaint.assetPath = '#ffffff@1.000';
  changedPaint.rootNode.fill = '#ffffff@1.000';

  assert.throws(
    () =>
      spliceFragment(
        project,
        {
          rootNodes: [
            { id: 'new-child', kind: 'javafx.scene.control.Label', children: [] },
          ],
          libraryItems: [changedPaint],
        },
        { appendTo: 'panel', updateSharedLibrary: true }
      ),
    /Shared Library mutation requires a shared replacement target.*editor-color-accent/
  );
});

test('public baseline selection materializes direct Library roots and aborts nested targets', () => {
  const project = projectFixture();
  const item = {
    id: 'shared-component',
    name: 'Shared Component',
    assetType: 'node',
    rootNode: {
      id: 'shared-component-root',
      kind: 'javafx.scene.layout.VBox',
      width: 320,
      children: [
        { id: 'shared-component-child', kind: 'javafx.scene.control.Label', children: [] },
      ],
    },
  };
  project.libraryItems.push(item);
  project.stages[0].rootNodes.push({
    id: 'shared-occurrence',
    kind: 'javafx.scene.layout.VBox',
    libraryItemId: item.id,
    libraryReference: true,
    children: [],
  });

  const ordinary = resolveNoOpBaselineTarget(project, 'panel');
  assert.equal(ordinary.libraryItemId, null);
  assert.equal(ordinary.rootNode.id, 'panel');
  assert.notEqual(ordinary.rootNode, project.stages[0].rootNodes[0]);
  const occurrence = resolveNoOpBaselineTarget(project, 'shared-occurrence');
  assert.equal(occurrence.libraryItemId, item.id);
  assert.equal(occurrence.rootNode.id, 'shared-occurrence');

  const direct = resolveNoOpBaselineTarget(project, item.rootNode.id);
  assert.equal(direct.libraryItemId, item.id);
  assert.equal(direct.rootNode.id, item.rootNode.id);
  assert.equal(direct.rootNode.libraryItemId, item.id);
  assert.equal(direct.rootNode.libraryReference, true);
  assert.deepEqual(direct.rootNode.children, []);
  assert.equal(project.libraryItems.at(-1).rootNode.children.length, 1, 'selection is non-mutating');

  assert.throws(
    () => resolveNoOpBaselineTarget(project, 'shared-component-child'),
    /Cannot build a complete authored baseline for nested direct Library target/
  );
  assert.throws(
    () =>
      spliceFragment(
        project,
        {
          rootNodes: [
            { id: 'edited-root', kind: 'javafx.scene.layout.VBox', children: [] },
          ],
          libraryItems: [],
        },
        { replace: item.rootNode.id }
      ),
    /Direct Library target "shared-component-root" requires updateSharedLibrary/
  );
});

test('scoped shared Library replacement reuses compatible transitive dependencies', () => {
  const project = projectFixture();
  project.libraryItems.push(
    {
      id: 'panel-component',
      assetType: 'node',
      rootNode: { id: 'panel-component_root', children: [] },
    },
    {
      id: 'shared-number-row',
      name: 'Number Row',
      assetType: 'node',
      parameterSchema: [
        { name: 'label', type: 'string', field: 'text', defaultValue: 'Canonical label' },
      ],
      rootNode: {
        id: 'shared-number-row_root',
        kind: 'javafx.scene.layout.Pane',
        text: 'Original',
        children: [
          { id: 'shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] },
        ],
      },
    }
  );

  const merged = mergeLibraryItems(
    project,
    [
      {
        id: 'panel-component',
        assetType: 'node',
        rootNode: { id: 'panel-component_root', text: 'Updated panel', children: [] },
      },
      {
        id: 'shared-number-row',
        name: 'Number Row',
        assetType: 'node',
        parameterSchema: [
          { name: 'label', type: 'string', field: 'text', defaultValue: 'Occurrence override' },
        ],
        rootNode: {
          id: 'shared-number-row_root',
          kind: 'javafx.scene.layout.Pane',
          text: 'Reconstructed dependency payload',
          children: [
            { id: 'shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] },
          ],
        },
      },
    ],
    [],
    true,
    'panel-component'
  );

  assert.equal(
    merged.libraryItems.find((item) => item.id === 'shared-number-row').rootNode.text,
    'Original',
    'the destination remains authoritative for transitive dependency payloads'
  );
  assert.equal(
    merged.libraryItems.find((item) => item.id === 'shared-number-row').parameterSchema[0]
      .defaultValue,
    'Canonical label',
    'a materialized occurrence value cannot rewrite the shared parameter default'
  );
  assert.equal(
    merged.libraryItems.find((item) => item.id === 'panel-component').rootNode.text,
    'Updated panel'
  );
});

test('stage Library occurrence reuses the compatible destination definition without cloning it', () => {
  const project = projectFixture();
  const existing = {
    id: 'shared-colour-row',
    name: 'Colour Row',
    assetType: 'node',
    rootNode: {
      id: 'shared-colour-row_root',
      kind: 'javafx.scene.layout.HBox',
      text: 'Canonical payload',
      children: [
        { id: 'shared-colour-row_control', kind: 'javafx.scene.control.Button', children: [] },
      ],
    },
  };
  project.libraryItems.push(existing);
  const imported = structuredClone(existing);
  imported.rootNode.text = 'Materialized occurrence payload';

  const roots = [{
    id: 'colour-row-occurrence',
    kind: 'javafx.scene.layout.HBox',
    libraryItemId: existing.id,
    libraryReference: true,
    children: [],
  }];
  const merged = mergeLibraryItems(project, [imported], roots, false);

  assert.equal(merged.libraryItems.length, project.libraryItems.length);
  assert.equal(
    merged.libraryItems.find((item) => item.id === existing.id).rootNode.text,
    'Canonical payload'
  );
  assert.deepEqual(merged.remapped, []);
  assert.equal(roots[0].libraryItemId, existing.id);
});

test('stage Library occurrence fails closed when its same-id shared interface has drifted', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'shared-colour-row',
    name: 'Colour Row',
    assetType: 'node',
    rootNode: {
      id: 'shared-colour-row_root',
      kind: 'javafx.scene.layout.HBox',
      children: [],
    },
  });
  const roots = [{
    id: 'colour-row-occurrence',
    kind: 'javafx.scene.layout.HBox',
    libraryItemId: 'shared-colour-row',
    libraryReference: true,
    children: [],
  }];

  assert.throws(
    () => mergeLibraryItems(project, [{
      id: 'shared-colour-row',
      name: 'Colour Row',
      assetType: 'node',
      rootNode: {
        id: 'shared-colour-row_root',
        kind: 'javafx.scene.layout.VBox',
        children: [],
      },
    }], roots, false),
    /incompatible shared interface/
  );
});

test('scoped replacement recognizes exporter-namespaced materialized dependency ids', () => {
  const project = projectFixture();
  project.libraryItems.push(
    {
      id: 'panel-component',
      assetType: 'node',
      rootNode: { id: 'panel-component_root', children: [] },
    },
    {
      id: 'shared-number-row',
      name: 'Number Row',
      assetType: 'node',
      parameterSchema: [
        { name: 'label', type: 'string', role: 'auto_c0', field: 'text', defaultValue: 'Width' },
      ],
      rootNode: {
        id: 'shared-number-row_root',
        kind: 'javafx.scene.layout.Pane',
        children: [
          { id: 'shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] },
          { id: 'shared-number-row_control', kind: 'javafx.scene.control.TextField', children: [] },
        ],
      },
    }
  );

  const merged = mergeLibraryItems(
    project,
    [
      {
        id: 'panel-component',
        assetType: 'node',
        rootNode: { id: 'panel-component_root', text: 'Updated panel', children: [] },
      },
      {
        id: 'shared-number-row',
        name: 'Number Row',
        assetType: 'node',
        parameterSchema: [
          { name: 'label', type: 'string', role: 'auto_c0', field: 'text', defaultValue: 'Arc Width' },
        ],
        rootNode: {
          id: 'shared-number-row_root',
          kind: 'javafx.scene.layout.Pane',
          children: [
            {
              id: 'arc_width__shared-number-row_label',
              kind: 'javafx.scene.control.Label',
              children: [],
            },
            {
              id: 'arc_width__shared-number-row_control',
              kind: 'javafx.scene.control.TextField',
              children: [],
            },
          ],
        },
      },
    ],
    [],
    true,
    'panel-component'
  );

  const dependency = merged.libraryItems.find((item) => item.id === 'shared-number-row');
  assert.equal(dependency.rootNode.children[0].id, 'shared-number-row_label');
  assert.equal(dependency.parameterSchema[0].defaultValue, 'Width');
});

test('scoped replacement still rejects arbitrary dependency node-id drift', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'shared-number-row',
    name: 'Number Row',
    assetType: 'node',
    rootNode: {
      id: 'shared-number-row_root',
      kind: 'javafx.scene.layout.Pane',
      children: [{ id: 'shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] }],
    },
  });

  assert.throws(
    () => mergeLibraryItems(
      project,
      [{
        id: 'shared-number-row',
        name: 'Number Row',
        assetType: 'node',
        rootNode: {
          id: 'shared-number-row_root',
          kind: 'javafx.scene.layout.Pane',
          children: [{ id: 'renamed-shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] }],
        },
      }],
      [],
      true,
      'panel-component'
    ),
    /incompatible shared Library interface/
  );
});

test('scoped shared Library replacement rejects transitive dependency interface drift', () => {
  const project = projectFixture();
  project.libraryItems.push(
    {
      id: 'panel-component',
      assetType: 'node',
      rootNode: { id: 'panel-component_root', children: [] },
    },
    {
      id: 'shared-number-row',
      name: 'Number Row',
      assetType: 'node',
      parameterSchema: [{ name: 'label', type: 'string', field: 'text' }],
      rootNode: {
        id: 'shared-number-row_root',
        kind: 'javafx.scene.layout.Pane',
        children: [
          { id: 'shared-number-row_label', kind: 'javafx.scene.control.Label', children: [] },
        ],
      },
    }
  );

  assert.throws(
    () =>
      mergeLibraryItems(
        project,
        [
          {
            id: 'panel-component',
            assetType: 'node',
            rootNode: { id: 'panel-component_root', text: 'Updated panel', children: [] },
          },
          {
            id: 'shared-number-row',
            name: 'Number Row',
            assetType: 'node',
            parameterSchema: [{ name: 'value', type: 'number', field: 'text' }],
            rootNode: {
              id: 'shared-number-row_root',
              kind: 'javafx.scene.layout.Pane',
              children: [
                { id: 'shared-number-row_value', kind: 'javafx.scene.control.TextField', children: [] },
              ],
            },
          },
        ],
        [],
        true,
        'panel-component'
      ),
    /incompatible shared Library interface.*may replace only target "panel-component"/
  );
});

test('scoped shared Library replacement rejects transitive event interface drift', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'shared-action-row',
    name: 'Action Row',
    assetType: 'node',
    eventSchema: [{ name: 'submit', role: 'submit_button' }],
    rootNode: { id: 'shared-action-row_root', kind: 'javafx.scene.layout.Pane', children: [] },
  });

  assert.throws(
    () =>
      mergeLibraryItems(
        project,
        [
          {
            id: 'shared-action-row',
            name: 'Action Row',
            assetType: 'node',
            eventSchema: [{ name: 'delete', role: 'delete_button' }],
            rootNode: {
              id: 'shared-action-row_root',
              kind: 'javafx.scene.layout.Pane',
              children: [],
            },
          },
        ],
        [],
        true,
        'panel-component'
      ),
    /incompatible shared Library interface/
  );
});

test('fragment splice rejects duplicate ids across stage and Library definitions', () => {
  const project = projectFixture();
  const fragment = {
    rootNodes: [{ id: 'new-shell', kind: 'javafx.scene.layout.Pane', children: [] }],
    libraryItems: [
      {
        id: 'new-component',
        assetType: 'node',
        rootNode: {
          id: 'new-component_root',
          children: [{ id: 'untouched', kind: 'javafx.scene.control.Label', children: [] }],
        },
      },
    ],
  };

  assert.throws(
    () => spliceFragment(project, fragment, { appendTo: 'panel' }),
    /globally unique across stages, the cell template, and Library definitions/
  );
});

test('fragment splice rejects duplicate ids across cell template and Library definitions', () => {
  const project = projectFixture();
  project.cellTemplate = {
    id: 'cell-template-root',
    kind: 'javafx.scene.layout.Pane',
    children: [{ id: 'cell-template-label', kind: 'javafx.scene.control.Label', children: [] }],
  };
  const fragment = {
    rootNodes: [{ id: 'new-shell', kind: 'javafx.scene.layout.Pane', children: [] }],
    libraryItems: [
      {
        id: 'new-component',
        assetType: 'node',
        rootNode: {
          id: 'new-component_root',
          children: [
            { id: 'cell-template-label', kind: 'javafx.scene.control.Label', children: [] },
          ],
        },
      },
    ],
  };

  assert.throws(
    () => spliceFragment(project, fragment, { appendTo: 'panel' }),
    /globally unique across stages, the cell template, and Library definitions/
  );
});

test('equal style values with multiple semantic roles require explicit mapping', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'editor-color-selection',
    name: 'Selection',
    assetType: 'color',
    assetPath: '#0096c9@1.000',
  });
  const fragment = {
    rootNodes: [{ kind: 'javafx.scene.layout.Pane', id: 'new_panel', children: [] }],
    libraryItems: [
      { id: 'imported-blue', name: 'Blue', assetType: 'color', assetPath: '#0096c9@1.000' },
    ],
  };
  const result = canonicalizeImportedStyleItems(project, fragment, {});
  assert.deepEqual(result.ambiguous, [
    {
      importedId: 'imported-blue',
      candidates: ['editor-color-accent', 'editor-color-selection'],
    },
  ]);
  assert.equal(fragment.libraryItems.length, 1, 'ambiguity never silently chooses a role');
});

test('same-id style tokens with the same typed value reuse the destination definition', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'editor-font-inter-11-bold',
    name: 'Inter 11 bold',
    assetType: 'font',
    rootNode: {
      id: 'editor-font-inter-11-bold-preview',
      fontFamily: 'Inter',
      fontSize: 11,
      fontWeight: 'BOLD',
      children: [],
    },
  });
  const fragment = {
    rootNodes: [
      {
        kind: 'javafx.scene.control.Label',
        id: 'new_label',
        fontLibraryItemId: 'editor-font-inter-11-bold',
        children: [],
      },
    ],
    libraryItems: [
      {
        id: 'editor-font-inter-11-bold',
        name: 'Inter 11 bold',
        assetType: 'font',
        rootNode: {
          id: 'editor-font-inter-11-bold-preview',
          fontFamily: 'Inter',
          fontSize: 11,
          fontWeight: 'BOLD',
          interactionSpecs: [],
          children: [],
        },
      },
    ],
  };

  const result = canonicalizeImportedStyleItems(project, fragment, {});

  assert.deepEqual(result.remapped, [
    { from: 'editor-font-inter-11-bold', to: 'editor-font-inter-11-bold' },
  ]);
  assert.deepEqual(fragment.libraryItems, []);
  assert.equal(
    fragment.rootNodes[0].fontLibraryItemId,
    'editor-font-inter-11-bold',
    'same-id references remain stable while the duplicate definition is dropped'
  );
});

test('same-id style tokens with a changed typed value remain an explicit Library mutation', () => {
  const project = projectFixture();
  project.libraryItems.push({
    id: 'editor-color-accent',
    name: 'Accent',
    assetType: 'color',
    assetPath: '#0096c9@1.000',
  });
  const fragment = {
    rootNodes: [{ kind: 'javafx.scene.layout.Pane', id: 'new_panel', children: [] }],
    libraryItems: [
      {
        id: 'editor-color-accent',
        name: 'Accent',
        assetType: 'color',
        assetPath: '#ff0000@1.000',
      },
    ],
  };

  canonicalizeImportedStyleItems(project, fragment, {});

  assert.equal(fragment.libraryItems.length, 1);
  assert.equal(fragment.libraryItems[0].assetPath, '#ff0000@1.000');
});

test('fragment CLI requires one explicit project splice operation', () => {
  assert.deepEqual(parseArgs(['panel.html']).project, '');
  assert.equal(
    parseArgs(['panel.html', '--project', 'project.json', '--replace', 'panel']).replace,
    'panel'
  );
  assert.throws(
    () => parseArgs(['panel.html', '--project', 'project.json']),
    /exactly one/
  );
  assert.throws(
    () =>
      parseArgs([
        'panel.html',
        '--project',
        'project.json',
        '--replace',
        'panel',
        '--append-to',
        'panel',
      ]),
    /exactly one/
  );
});

test('fragment node counts include exported control skin subcomponents', () => {
  assert.equal(
    countNodes([
      {
        id: 'scroll',
        children: [{ id: 'row' }],
        skinSubcomponents: [{ id: 'thumb' }, { id: 'track' }],
      },
    ]),
    4
  );
});
