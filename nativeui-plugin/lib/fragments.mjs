import { runCli } from './cli.mjs';
export { mergeStage, mergeLibraryItems } from '../bin/nui-screen-update.mjs';
export { resolveStage } from '../bin/nui-screen-extract.mjs';
export async function extractFragment({ projectPath, nodeId, outPath }) { return runCli('nui-fragment-extract.mjs', [projectPath, '--id', nodeId, ...(outPath ? ['--output', outPath] : [])]); }
export async function importFragment({
  snippetPath,
  outPath,
  nodesOnly = false,
  projectPath,
  replaceNodeId,
  appendToNodeId,
  recipePath,
  updateSharedLibrary = false,
  dryRun = false,
}) {
  return runCli('nui-fragment-import.mjs', [
    snippetPath,
    ...(outPath ? ['--output', outPath] : []),
    ...(nodesOnly ? ['--nodes-only'] : []),
    ...(projectPath ? ['--project', projectPath] : []),
    ...(replaceNodeId ? ['--replace', replaceNodeId] : []),
    ...(appendToNodeId ? ['--append-to', appendToNodeId] : []),
    ...(recipePath ? ['--recipe', recipePath] : []),
    ...(updateSharedLibrary ? ['--update-shared-library'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]);
}
export async function extractScreen({ projectPath, stage, outPath }) { return runCli('nui-screen-extract.mjs', [projectPath, '--stage', stage, ...(outPath ? ['--output', outPath] : [])]); }
export async function updateScreen({ projectPath, htmlPath, stage, options = {} }) { return runCli('nui-screen-update.mjs', [projectPath, htmlPath, '--stage', stage, ...(options.rename ? ['--rename', options.rename] : []), ...(options.replaceStageInteractions ? ['--replace-stage-interactions'] : []), ...(options.updateSharedLibrary ? ['--update-shared-library'] : []), ...(options.dryRun ? ['--dry-run'] : [])]); }
