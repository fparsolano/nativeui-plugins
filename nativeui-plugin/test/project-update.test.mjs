import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeProjectAtomically } from '../lib/project-update.mjs';

test('atomic project updates preserve the existing JSON indentation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nui-project-update-'));
  const projectPath = path.join(directory, 'project.json');
  const project = {
    version: 4,
    stages: [
      {
        name: 'Editor',
        rootNodes: [{ kind: 'javafx.scene.layout.Pane', id: 'root', children: [] }],
      },
    ],
    libraryItems: [],
  };
  try {
    await writeFile(projectPath, JSON.stringify(project, null, 1) + '\n');
    project.projectName = 'Updated';
    await writeProjectAtomically(projectPath, project, 'indent-test');
    const updated = await readFile(projectPath, 'utf8');
    assert.match(updated, /^\{\n "version": 4,/);
    assert.doesNotMatch(updated, /^\{\n  "version": 4,/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
