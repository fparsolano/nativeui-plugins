import { runCli, jsonOutput } from './cli.mjs';
export { hashText, summarizeStatus } from '../bin/nui-project-sync.mjs';
export { webEditorUrl } from '../bin/nui-preview.mjs';
export async function saveProjectByName({ projectPath, name, location = '' }) { return runCli('nui-save.mjs', [projectPath, '--name', name, ...(location ? ['--location', location] : [])]); }
export async function previewProject({ projectPath, name, location = '' }) { return runCli('nui-preview.mjs', [projectPath, '--name', name, ...(location ? ['--location', location] : [])]); }
export async function syncStatus({ projectPath, projectId, name }) { return jsonOutput(await runCli('nui-project-sync.mjs', ['status', projectPath, ...(projectId ? ['--project-id', projectId] : ['--name', name]) ])); }
export async function syncPull({ projectPath, projectId, name }) { return jsonOutput(await runCli('nui-project-sync.mjs', ['pull', projectPath, ...(projectId ? ['--project-id', projectId] : ['--name', name]) ])); }
export async function syncPush({ projectPath, projectId, name, location = '' }) { return jsonOutput(await runCli('nui-project-sync.mjs', ['push', projectPath, '--name', name, ...(projectId ? ['--project-id', projectId] : []), ...(location ? ['--location', location] : []) ])); }
