import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCli } from './cli.mjs';

// Keep the hardened extraction implementation in its long-standing import path while
// consumers migrate; it remains the single authority for seam preservation.
export { extractProtected, WRITE_ONCE_BASENAMES } from '../bin/nui-export.mjs';

export async function runExport({ projectJson, targets, outdir, manifest = false, mode = 'prod', nativeOptions = {}, force = false }) {
  const temporary = path.join(outdir, `.nativeui-mcp-${process.pid}.json`);
  await fs.mkdir(path.resolve(outdir), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(projectJson));
  try {
    const optionFlags = Object.entries(nativeOptions).flatMap(([key, value]) => value === undefined || value === false ? [] : value === true ? [`--${key}`] : [`--${key}`, String(value)]);
    const result = await runCli('nui-export.mjs', [temporary, ...(targets || []).flatMap((target) => ['--target', target]), '-o', outdir, ...(manifest ? ['--manifest'] : []), '--mode', mode, ...(force ? ['--force'] : []), ...optionFlags]);
    return { output: result.stdout.trim() };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
