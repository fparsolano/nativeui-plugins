// config.mjs — load/merge NativeUI config + credentials.
//
// Pure Node (Node 18+), no npm deps. Provides:
//   getConfig()  -> { exportServiceUrl, billingApiUrl, exportAuthMode }
//   loadCreds()  -> { idToken, refreshToken, expiresAt } | null
//   saveCreds(c) -> persists credentials to ~/.nativeui/credentials.json (0600)
//   clearCreds() -> removes the cached credentials file
//   CONFIG_PATH / CREDS_PATH / CONFIG_DIR
//
// Config resolution order (later wins for each individual field):
//   1. BUILT-IN DEFAULTS  (NativeUI service hosts — baked in)
//   2. ~/.nativeui/config.json   (file)
//   3. NATIVEUI_* environment variables
//
// Because the defaults are baked in, a normal user does NOT configure anything.
// They just sign in with browser SSO. Firebase / identity-provider API keys stay
// server-side in profile-api; the local CLI stores only the signed-in session.
//
// Recognized env overrides:
//   NATIVEUI_EXPORT_SERVICE_URL, NATIVEUI_BILLING_API_URL, NATIVEUI_EXPORT_AUTH_MODE
//
// getConfig() still FAILS CLOSED if a field is somehow blanked out (e.g. an
// override sets it to "") — but with the defaults present that does not happen
// for a normal install.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = path.join(os.homedir(), '.nativeui');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const CREDS_PATH = path.join(CONFIG_DIR, 'credentials.json');

// Baked-in defaults so the plugin works with zero configuration — the user only
// signs in (SSO). To target a different environment, override via
// ~/.nativeui/config.json or the NATIVEUI_* env vars (per-field). Swap these to
// the prod values when the plugin graduates from the dev backend.
export const DEFAULT_CONFIG = {
  exportServiceUrl: 'https://dev.nativeui.com',
  billingApiUrl: 'https://dev.nativeui.com/api/billing',
  exportAuthMode: 'nativeui',
};

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readJsonSync(file) {
  // synchronous read via fs.promises is not available; use a tiny sync fallback.
  // We keep config loading async-friendly but tolerant of a missing file.
  return fs.readFile(file, 'utf8').then(
    (txt) => {
      try {
        return JSON.parse(txt);
      } catch (e) {
        throw new ConfigError(
          `Config file ${file} is not valid JSON: ${e.message}\n` +
            `Fix the file or re-create it from bin/config.example.json.`
        );
      }
    },
    (err) => {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  );
}

function trimTrailingSlash(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/\/+$/, '');
}

function valueFromLayers(envName, fileCfg, fileKey, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(process.env, envName)) return process.env[envName];
  if (fileCfg && Object.prototype.hasOwnProperty.call(fileCfg, fileKey)) return fileCfg[fileKey];
  return defaultValue;
}

function normalizeExportAuthMode(value) {
  return String(value || DEFAULT_CONFIG.exportAuthMode).trim().toLowerCase();
}

/**
 * Load + merge config from file and env. Returns a fully-populated, validated
 * config object or throws ConfigError listing exactly what's missing.
 */
export async function getConfig() {
  const fileCfg = (await readJsonSync(CONFIG_PATH)) || {};

  const exportServiceUrl = trimTrailingSlash(
    valueFromLayers('NATIVEUI_EXPORT_SERVICE_URL', fileCfg, 'exportServiceUrl', DEFAULT_CONFIG.exportServiceUrl)
  );
  const billingApiUrl = trimTrailingSlash(
    valueFromLayers('NATIVEUI_BILLING_API_URL', fileCfg, 'billingApiUrl', DEFAULT_CONFIG.billingApiUrl)
  );
  const exportAuthMode = normalizeExportAuthMode(
    valueFromLayers('NATIVEUI_EXPORT_AUTH_MODE', fileCfg, 'exportAuthMode', DEFAULT_CONFIG.exportAuthMode)
  );

  if (exportAuthMode !== 'nativeui' && exportAuthMode !== 'none') {
    throw new ConfigError(
      `NativeUI config has invalid exportAuthMode "${exportAuthMode}".\n` +
        `Use "nativeui" for the hosted NativeUI service, or "none" only for an approved internal/self-hosted export service.\n`
    );
  }

  const missing = [];
  if (!exportServiceUrl) missing.push('exportServiceUrl (or env NATIVEUI_EXPORT_SERVICE_URL)');
  if (exportAuthMode === 'nativeui' && !billingApiUrl) {
    missing.push('billingApiUrl (or env NATIVEUI_BILLING_API_URL)');
  }

  if (missing.length) {
    // With baked defaults this only triggers if an override blanked a field.
    throw new ConfigError(
      `NativeUI config has an empty value for:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\n\nThe plugin ships working NativeUI service defaults (dev backend), so normally you configure nothing —\n` +
        `you only sign in (SSO). It looks like an override in "${CONFIG_PATH}" or a NATIVEUI_* env var set\n` +
        `one of these to an empty value. Remove that override to use the default, or give it a real value.\n`
    );
  }

  return { exportServiceUrl, billingApiUrl, exportAuthMode };
}

/** Load cached credentials, or null if none / unreadable. */
export async function loadCreds() {
  const raw = await readJsonSync(CREDS_PATH);
  if (!raw) return null;
  if (!raw.idToken || !raw.refreshToken) return null;
  return {
    idToken: raw.idToken,
    refreshToken: raw.refreshToken,
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : 0,
    email: raw.email,
    uid: raw.uid,
  };
}

/** Persist credentials to ~/.nativeui/credentials.json with 0600 perms. */
export async function saveCreds(creds) {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const body = JSON.stringify(
    {
      idToken: creds.idToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      email: creds.email,
      uid: creds.uid,
    },
    null,
    2
  );
  await fs.writeFile(CREDS_PATH, body, { mode: 0o600 });
  // Ensure perms even if the file pre-existed with looser mode.
  try {
    await fs.chmod(CREDS_PATH, 0o600);
  } catch {
    /* best-effort */
  }
  return CREDS_PATH;
}

/** Remove cached credentials (logout). No error if absent. */
export async function clearCreds() {
  try {
    await fs.unlink(CREDS_PATH);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}
