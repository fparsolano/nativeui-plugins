import { runCli, jsonOutput } from './cli.mjs';
export async function upsertLibraryItem({ command, projectPath, name, options = {} }) { return jsonOutput(await runCli('nui-library.mjs', [command, projectPath, '--name', name, ...Object.entries(options).flatMap(([key, value]) => value == null ? [] : [`--${key}`, String(value)]), '--json'])); }
export async function secretStatus({ projectId, itemId }) { return jsonOutput(await runCli('nui-library.mjs', ['secret-status', '--project-id', projectId, '--item-id', itemId, '--json'])); }
export async function testLibraryItem({ projectId, itemId, kind, config }) { return jsonOutput(await runCli('nui-library.mjs', ['test', '--project-id', projectId, '--item-id', itemId, '--kind', kind, '--config-json', JSON.stringify(config), '--json'])); }
export async function putSecret() { throw new Error('Secrets are intentionally CLI-only: use nui-library.mjs put-secret --secret-stdin.'); }
