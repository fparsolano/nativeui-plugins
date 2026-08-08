import { runCli } from './cli.mjs';
export { reportParityBug } from '../bin/nui-report-parity.mjs';
export async function reportParity({ title, description = '', projectPath = '' }) { return runCli('nui-report-parity.mjs', ['--title', title, ...(description ? ['--description', description] : []), ...(projectPath ? ['--project', projectPath] : [])]); }
