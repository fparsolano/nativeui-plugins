import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, ServiceError } from './errors.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Invoke a compatibility CLI without a shell and return its structured process result. */
export async function runCli(script, args, { input } = {}) {
  const file = path.join(PLUGIN_ROOT, 'bin', script);
  const child = spawn(process.execPath, [file, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const result = { code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
  if (code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `${script} failed`;
    const errorCode = code === 2 || /changed since last sync|revision/i.test(message) ? ErrorCode.REVISION_CONFLICT
      : /not logged in|run: node bin\/login/i.test(message) ? ErrorCode.NOT_LOGGED_IN
        : /not valid JSON|missing|invalid project|structural/i.test(message) ? ErrorCode.INVALID_PROJECT
          : ErrorCode.SERVICE_REJECTED;
    throw new ServiceError(errorCode, message, errorCode === ErrorCode.REVISION_CONFLICT
      ? 'Call nativeui_project_pull, resolve the change, then push again.'
      : errorCode === ErrorCode.NOT_LOGGED_IN ? 'Call nativeui_login_start and have the user approve the sign-in in their browser.' : 'Correct the request and retry.');
  }
  return result;
}

export function jsonOutput(result) {
  const text = result.stdout.trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { output: text }; }
}
