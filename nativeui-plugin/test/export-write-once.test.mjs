// export-write-once.test.mjs — re-export must NOT clobber the developer-owned write-once seam
// files (AppActions.swift / NuiBackend.*): the developer's copy survives, and a CHANGED generated
// contract lands beside it as `<name>.new` instead of silently vanishing (audit blocker A2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { extractProtected, WRITE_ONCE_BASENAMES } = await import(
  pathToFileURL(path.join(here, '..', 'bin', 'nui-export.mjs')).href
);
const posixPaths = (values) => values.map((value) => value.split(path.sep).join('/'));
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

function withManifest(files, { targetId = 'ios-swiftui', writeOnce = [] } = {}) {
  const generatedFiles = [...Object.keys(files).filter((file) => !writeOnce.includes(file)), 'nativeui-export-manifest.json'].sort();
  const manifest = {
    schemaVersion: 2,
    targetIds: [targetId],
    generatedFiles,
    writeOnceFiles: [...writeOnce].sort(),
  };
  return { ...files, 'nativeui-export-manifest.json': `${JSON.stringify(manifest)}\n` };
}

async function makeZip(dir, files) {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-src-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(src, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  const zip = path.join(dir, 'export.zip');
  let r = spawnSync('zip', ['-r', '-q', zip, '.'], { cwd: src });
  if (r.error?.code === 'ENOENT') {
    r = spawnSync('tar', ['-a', '-c', '-f', zip, '.'], { cwd: src });
  }
  assert.equal(r.status, 0, r.stderr?.toString() || 'zip or tar archive tool available');
  await fs.rm(src, { recursive: true, force: true });
  return zip;
}

test('manifest ownership prunes stale generated files and only changed seam hashes create .new', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'nui-a2-'));
  const dest = path.join(work, 'proj');
  await fs.mkdir(dest, { recursive: true });

  // First export: stub AppActions + a generated screen.
  const zip1 = await makeZip(work, withManifest({
    'App/Services/AppActions.swift': `// @nativeui-contract ${hashA}\nstub v1`,
    'App/Screens/MainView.swift': 'screen v1',
    'App/Screens/RemovedView.swift': 'obsolete generated screen',
    '.gitignore': 'build\n',
  }, { writeOnce: ['App/Services/AppActions.swift', '.gitignore'] }));
  const r1 = await extractProtected(zip1, dest, false);
  assert.ok(r1.tool, 'extractor available');
  assert.match(await fs.readFile(path.join(dest, 'App/Services/AppActions.swift'), 'utf8'), /stub v1/);

  // Developer wires their backend.
  await fs.writeFile(path.join(dest, 'App/Services/AppActions.swift'), `// @nativeui-contract ${hashA}\nMY WIRING`);
  await fs.writeFile(path.join(dest, '.gitignore'), 'build\nmy-local-secret.env\n');
  await fs.writeFile(path.join(dest, 'developer-notes.md'), 'unowned developer file');

  // A body-only stub refresh with the SAME contract hash must not create noise.
  await fs.rm(path.join(work, 'export.zip'));
  const zip2 = await makeZip(work, withManifest({
    'App/Services/AppActions.swift': `// @nativeui-contract ${hashA}\nrefreshed comments only`,
    'App/Screens/MainView.swift': 'screen v2',
    'App/Screens/NewView.swift': 'new generated screen',
    '.gitignore': 'build\ndist\n',
  }, { writeOnce: ['App/Services/AppActions.swift', '.gitignore'] }));
  const r2 = await extractProtected(zip2, dest, false);

  assert.equal(
    await fs.readFile(path.join(dest, 'App/Services/AppActions.swift'), 'utf8'),
    `// @nativeui-contract ${hashA}\nMY WIRING`,
    'developer edit preserved'
  );
  await assert.rejects(fs.access(path.join(dest, 'App/Services/AppActions.swift.new')));
  await assert.rejects(fs.access(path.join(dest, '.gitignore.new')));
  await assert.rejects(fs.access(path.join(dest, 'App/Screens/RemovedView.swift')));
  assert.equal(await fs.readFile(path.join(dest, 'developer-notes.md'), 'utf8'), 'unowned developer file');
  assert.equal(
    await fs.readFile(path.join(dest, 'App/Screens/MainView.swift'), 'utf8'),
    'screen v2',
    'generated screens still update'
  );
  assert.deepEqual(posixPaths(r2.preserved), ['.gitignore', 'App/Services/AppActions.swift']);
  assert.deepEqual(posixPaths(r2.contractUpdates), []);
  assert.deepEqual(posixPaths(r2.pruned), ['App/Screens/RemovedView.swift']);

  // The next export changes the contract hash, so the fresh implementation candidate is useful.
  await fs.rm(path.join(work, 'export.zip'));
  const zip3 = await makeZip(work, withManifest({
    'App/Services/AppActions.swift': `// @nativeui-contract ${hashB}\nstub v3 with callApi`,
    'App/Screens/MainView.swift': 'screen v3',
    '.gitignore': 'build\ndist\n',
  }, { writeOnce: ['App/Services/AppActions.swift', '.gitignore'] }));
  const changed = await extractProtected(zip3, dest, false);
  assert.match(await fs.readFile(path.join(dest, 'App/Services/AppActions.swift.new'), 'utf8'), new RegExp(hashB));
  assert.deepEqual(posixPaths(changed.contractUpdates), ['App/Services/AppActions.swift']);
  await assert.rejects(fs.access(path.join(dest, '.gitignore.new')));

  // --force restores plain overwrite.
  const r3 = await extractProtected(zip3, dest, true);
  assert.ok(r3.tool);
  assert.match(await fs.readFile(path.join(dest, 'App/Services/AppActions.swift'), 'utf8'), /stub v3 with callApi/);
  await fs.rm(work, { recursive: true, force: true });
});

test('protected basename set covers all lane seam files', () => {
  // Mobile lanes (Swift/Kotlin) + the Rust lane's write-once dev-seam (src/app_actions.rs).
  for (const f of ['AppActions.swift', 'NuiBackend.swift', 'NuiBackend.kt', 'NuiAppActionsImpl.kt', 'app_actions.rs', 'AppActions.cs', 'app-actions.js']) {
    assert.ok(WRITE_ONCE_BASENAMES.has(f), f);
  }
});

test('export archives can never introduce .gitignore.new', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'nui-gitignore-new-'));
  try {
    const zip = await makeZip(work, { '.gitignore.new': 'must not land\n' });
    await assert.rejects(
      extractProtected(zip, path.join(work, 'project'), false),
      /Refusing \.gitignore\.new/,
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test('Rust lane src/app_actions.rs survives re-export like the mobile seam files', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'nui-rust-a2-'));
  const dest = path.join(work, 'proj');
  await fs.mkdir(dest, { recursive: true });

  // First export: a Rust Cargo project — write-once app_actions.rs + a regenerated screen.
  const zip1 = await makeZip(work, withManifest({
    'src/app_actions.rs': `// @nativeui-contract ${hashA}\nstub v1`,
    'src/screens/stage_0.rs': 'screen v1',
  }, { targetId: 'rust-desktop', writeOnce: ['src/app_actions.rs'] }));
  const r1 = await extractProtected(zip1, dest, false);
  assert.ok(r1.tool, 'extractor available');
  assert.match(await fs.readFile(path.join(dest, 'src/app_actions.rs'), 'utf8'), /stub v1/);

  // Developer implements NuiBackend for AppActions.
  await fs.writeFile(path.join(dest, 'src/app_actions.rs'), `// @nativeui-contract ${hashA}\nimpl NuiBackend for AppActions { /* MY WIRING */ }`);

  // Second export: contract stub changed upstream + screen regenerated.
  await fs.rm(path.join(work, 'export.zip'));
  const zip2 = await makeZip(work, withManifest({
    'src/app_actions.rs': `// @nativeui-contract ${hashB}\nstub v2 with on_call_api`,
    'src/screens/stage_0.rs': 'screen v2',
  }, { targetId: 'rust-desktop', writeOnce: ['src/app_actions.rs'] }));
  const r2 = await extractProtected(zip2, dest, false);

  assert.equal(
    await fs.readFile(path.join(dest, 'src/app_actions.rs'), 'utf8'),
    `// @nativeui-contract ${hashA}\nimpl NuiBackend for AppActions { /* MY WIRING */ }`,
    'developer Rust dev-seam edit preserved'
  );
  assert.equal(
    await fs.readFile(path.join(dest, 'src/app_actions.rs.new'), 'utf8'),
    `// @nativeui-contract ${hashB}\nstub v2 with on_call_api`,
    'changed Rust contract surfaced as .new'
  );
  assert.equal(
    await fs.readFile(path.join(dest, 'src/screens/stage_0.rs'), 'utf8'),
    'screen v2',
    'generated Rust screens still update'
  );
  assert.deepEqual(posixPaths(r2.preserved), ['src/app_actions.rs']);
  assert.deepEqual(posixPaths(r2.contractUpdates), ['src/app_actions.rs']);
  await fs.rm(work, { recursive: true, force: true });
});
