import { runCli } from './cli.mjs';

export async function validateProject({ projectPath, structuralOnly = false, platform = 'android' }) {
  const result = await runCli('nui-validate.mjs', [projectPath, ...(structuralOnly ? ['--structural'] : []), '--platform', platform]);
  return { ok: true, output: result.stdout.trim(), modelChecked: !structuralOnly };
}
