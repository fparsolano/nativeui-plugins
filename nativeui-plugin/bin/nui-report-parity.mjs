// nui-report-parity.mjs — thin client that reports a parity DELTA to bugs-api (collection: parityBugs).
//
// The beta parity loop (Track F) detects a per-node render delta (editor vs iOS/Android/webapp) and
// files it as a structured parity bug. This is a thin POST to bugs-api /parity with the cached token:
//   { title, description, severity, parityType, parity:{targetFramework,expected,actual,delta},
//     attachments:[{gcsPath,mediaType}] }
//
// Importable: reportParityBug(payload) for Track F to call directly.
// CLI: node bin/nui-report-parity.mjs --payload delta.json
//      node bin/nui-report-parity.mjs --title "..." --framework ios --delta '{"node":"x","dx":3}'
//
// Requires being logged in (bin/login.mjs). Fails closed.

import { promises as fs } from 'node:fs';
import { getConfig, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { requireNativeUiAuthMode } from './auth-mode.mjs';

export class ReportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportError';
  }
}

/** Base URL for bugs-api: explicit override, else <exportServiceUrl>/api/bugs (Hosting rewrite). */
function bugsApiBase(config) {
  const override = (process.env.NATIVEUI_BUGS_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/bugs`;
}

/**
 * Report a parity bug. `payload` is the request body (title required). `opts.token` lets a caller
 * pass a fresh token; otherwise one is obtained from the cached creds. Returns the created bug row.
 * Thin: does no detection, just POSTs the structured payload.
 */
export async function reportParityBug(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new ReportError('A parity payload object is required.');
  }
  if (!payload.title || !String(payload.title).trim()) {
    throw new ReportError('payload.title is required.');
  }
  const config = opts.config || (await getConfig());
  requireNativeUiAuthMode(config, 'nui-report-parity');
  const token = opts.token || (await getFreshToken());
  const base = bugsApiBase(config);

  let res;
  try {
    res = await fetch(`${base}/parity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new ReportError(`Network error contacting bugs service: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ReportError('Authentication rejected by bugs service.\n  Run: node bin/login.mjs');
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ReportError(`Bugs service returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new ReportError(`Report failed (HTTP ${res.status}): ${json.error || text.slice(0, 300)}`);
  }
  return json;
}

function parseArgs(argv) {
  const out = { payloadFile: '', flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--payload' || a === '-p') out.payloadFile = argv[++i] || '';
    else if (a === '--title') out.flags.title = argv[++i];
    else if (a === '--description') out.flags.description = argv[++i];
    else if (a === '--severity') out.flags.severity = argv[++i];
    else if (a === '--type') out.flags.parityType = argv[++i];
    else if (a === '--framework') out.flags.targetFramework = argv[++i];
    else if (a === '--delta') out.flags.delta = argv[++i];
    else if (a === '-h' || a === '--help')
      throw new ReportError('Usage: node bin/nui-report-parity.mjs --payload delta.json');
    else throw new ReportError(`Unknown flag: ${a}`);
  }
  return out;
}

async function buildPayloadFromArgs({ payloadFile, flags }) {
  if (payloadFile) {
    let raw;
    try {
      raw = await fs.readFile(payloadFile, 'utf8');
    } catch (e) {
      throw new ReportError(`Could not read payload ${payloadFile}: ${e.message}`);
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new ReportError(`Payload ${payloadFile} is not valid JSON: ${e.message}`);
    }
  }
  // Build from flags.
  const payload = {
    title: flags.title,
    description: flags.description || '',
    severity: flags.severity || 'medium',
    parityType: flags.parityType || 'render-delta',
    parity: {},
  };
  if (flags.targetFramework) payload.parity.targetFramework = flags.targetFramework;
  if (flags.delta) {
    try {
      payload.parity.delta = JSON.parse(flags.delta);
    } catch {
      payload.parity.delta = flags.delta;
    }
  }
  return payload;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const payload = await buildPayloadFromArgs(args);
    const row = await reportParityBug(payload);
    process.stdout.write(`Reported parity bug "${row.title}" (id: ${row.id})\n`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof ReportError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

// Run only when invoked directly (so Track F can import reportParityBug).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
