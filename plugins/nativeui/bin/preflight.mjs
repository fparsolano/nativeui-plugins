// preflight.mjs — gate that every action skill runs first.
//
// Verifies:
//   (a) configured + logged in (a fresh idToken can be obtained), AND
//   (b) the account has an active subscription (GET <billing>/subscription
//       -> { active:true }).
//
// On success: prints "ok: <email>, subscription active" and exits 0.
// On failure: prints the exact remedy and exits non-zero.
//
// Usage:  node bin/preflight.mjs

import { getConfig, loadCreds, ConfigError } from './config.mjs';
import { getFreshToken, AuthError } from './token.mjs';
import { isExportOnly } from './auth-mode.mjs';

class PreflightError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'PreflightError';
    this.code = code;
  }
}

async function checkSubscription(config, token) {
  const url = `${config.billingApiUrl}/subscription`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new PreflightError(`Network error contacting billing service: ${e.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new PreflightError('Authentication rejected by billing service.\n  Run: node bin/login.mjs');
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    throw new PreflightError(
      `Could not check subscription (HTTP ${res.status}).\n` +
        `  Try again shortly, or contact support if it persists.`
    );
  }

  if (json.active !== true) {
    const status = json.status ? ` (status: ${json.status})` : '';
    throw new PreflightError(
      `No active NativeUI subscription${status}.\n` +
        `  Activate a subscription at ${config.billingApiUrl.replace(/\/api.*/, '')}` +
        ` (see your account billing page), then re-run.`
    );
  }
  return json;
}

async function main() {
  try {
    const config = await getConfig();
    if (isExportOnly(config)) {
      process.stdout.write(
        `ok: export-only mode; NativeUI login/subscription skipped for ${config.exportServiceUrl}\n`
      );
      process.exit(0);
    }
    const token = await getFreshToken();
    const creds = await loadCreds();
    const email = (creds && creds.email) || 'unknown';

    await checkSubscription(config, token);

    process.stdout.write(`ok: ${email}, subscription active\n`);
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError || err instanceof PreflightError) {
      process.stderr.write(err.message + '\n');
      process.exit(err.code || 1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
