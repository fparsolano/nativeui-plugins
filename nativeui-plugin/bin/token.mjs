// token.mjs — print a FRESH Firebase idToken to stdout.
//
// Refreshes through profile-api when the idToken is expired or close to expiry.
// Exits non-zero with an actionable message if not logged in.
//
// Usage:  node bin/token.mjs
// Exposes getFreshToken() for the other scripts (they import it directly).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig, loadCreds, saveCreds, ConfigError } from './config.mjs';

// Refresh when fewer than this many ms remain on the token.
const REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

const NOT_LOGGED_IN =
  'Not logged in to NativeUI.\n  Run: node bin/login.mjs';

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AuthError(`Network error contacting auth service: ${e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

/** Base URL for profile-api: explicit override, else <exportServiceUrl>/api/profile. */
function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
}

/**
 * Exchange a cached refreshToken for a fresh idToken through profile-api.
 * Returns updated creds {idToken, refreshToken, expiresAt, email, uid}.
 */
async function refreshIdToken(config, creds) {
  const { res, json } = await postJson(`${profileApiBase(config)}/cli/session/refresh`, {
    refreshToken: creds.refreshToken,
  });

  if (!res.ok) {
    const code = json && (json.code || json.error);
    if (
      code === 'TOKEN_EXPIRED' ||
      code === 'USER_DISABLED' ||
      code === 'USER_NOT_FOUND' ||
      code === 'INVALID_REFRESH_TOKEN' ||
      code === 'missing_refresh_token'
    ) {
      throw new AuthError(
        `Your session has expired or is invalid (${code}).\n  Run: node bin/login.mjs`
      );
    }
    throw new AuthError(
      `NativeUI session refresh failed (HTTP ${res.status})${code ? `: ${code}` : ''}.\n  Run: node bin/login.mjs`
    );
  }

  const expiresInSec = parseInt(json.expiresIn, 10) || 3600;
  if (!json.idToken || !json.refreshToken) {
    throw new AuthError('NativeUI session refresh returned an incomplete session.\n  Run: node bin/login.mjs');
  }
  const updated = {
    idToken: json.idToken,
    refreshToken: json.refreshToken || creds.refreshToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    email: json.email || creds.email,
    uid: json.uid || creds.uid,
  };
  await saveCreds(updated);
  return updated;
}

/**
 * Return a fresh idToken string, refreshing if needed. Throws AuthError when
 * not logged in or when the refresh fails.
 */
export async function getFreshToken() {
  const config = await getConfig();
  const creds = await loadCreds();
  if (!creds) throw new AuthError(NOT_LOGGED_IN);

  const needsRefresh = !creds.idToken || !creds.expiresAt || creds.expiresAt - Date.now() < REFRESH_SKEW_MS;
  if (!needsRefresh) return creds.idToken;

  if (!creds.refreshToken) throw new AuthError(NOT_LOGGED_IN);
  const updated = await refreshIdToken(config, creds);
  return updated.idToken;
}

async function main() {
  try {
    const token = await getFreshToken();
    process.stdout.write(token + '\n');
  } catch (err) {
    if (err instanceof ConfigError || err instanceof AuthError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

// Run only when invoked directly (so other scripts can import getFreshToken).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
