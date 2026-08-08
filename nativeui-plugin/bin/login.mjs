// login.mjs — 'nativeui login'.
//
// Sign-in is browser SSO (the only interactive method):
//   --sso       (DEFAULT) browser device-authorization (RFC 8628). The CLI requests a device+user code
//               from profile-api, builds a code-PREFILLED verification URL (…/device?userCode=…), best-effort
//               AUTO-OPENS the browser to it AND prints the URL+code (so the agent can paste it if the browser
//               didn't open), then polls until the user approves in the browser. profile-api exchanges the
//               identity-provider token server-side and returns a CLI session; no Firebase/API keys live locally.
//
// Usage:  node bin/login.mjs                 (SSO device flow — default)
//         node bin/login.mjs --sso

import { spawn } from 'node:child_process';
import { getConfig, saveCreds, ConfigError } from './config.mjs';

class LoginError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoginError';
  }
}

function parseArgs(argv) {
  let mode = 'sso'; // default
  for (const a of argv) {
    if (a === '--sso') mode = 'sso';
    else if (a === '--password') throw new LoginError('Password login has been removed. Run: node bin/login.mjs');
    else if (a === '-h' || a === '--help') mode = 'help';
    else throw new LoginError(`Unknown flag: ${a}\n  Usage: node bin/login.mjs [--sso]`);
  }
  return { mode };
}

/** Base URL for profile-api: explicit override, else <exportServiceUrl>/api/profile (Hosting rewrite). */
function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  if (override) return override;
  return `${config.exportServiceUrl}/api/profile`;
}

/**
 * The /device verification page lives on the WEB APP origin (the configured exportServiceUrl, i.e.
 * https://dev.nativeui.com on the dev stack). Use the server-returned verificationUri ONLY when it's
 * same-origin as the configured host; otherwise anchor /device on the configured origin so the user is
 * always sent to the real web app (never a Cloud-Run-internal host).
 */
function sameOriginDeviceUri(serverUri, exportServiceUrl) {
  const fallback = `${exportServiceUrl}/device`;
  if (!serverUri) return fallback;
  try {
    const want = new URL(exportServiceUrl).host;
    const got = new URL(serverUri).host;
    return got === want ? serverUri : fallback;
  } catch {
    return fallback;
  }
}

async function postJson(url, body, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new LoginError(`Network error contacting ${url}: ${e.message}`);
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

// ── SSO device flow ───────────────────────────────────────────────────────────────────────────────

/** Best-effort open the verification URL in the user's browser; never fatal if it can't. */
function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* best-effort */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ssoLogin(config) {
  const base = profileApiBase(config);

  // 1. Request a device + user code.
  const { res: codeRes, json: code } = await postJson(`${base}/cli/device/code`, {});
  if (!codeRes.ok || !code.deviceCode || !code.userCode) {
    throw new LoginError(
      `Could not start browser sign-in (HTTP ${codeRes.status}). Please try again in a moment.`
    );
  }

  // The user must approve on the WEB APP origin where they're signed in (the dev stack:
  // https://dev.nativeui.com/device). Anchor /device on the configured export origin; only honor the
  // server-returned verificationUri when it's same-origin (so a Cloud-Run-internal host can't leak in).
  const verificationUri = sameOriginDeviceUri(code.verificationUri, config.exportServiceUrl);
  const interval = Math.max(2, Number(code.interval) || 5) * 1000;
  const expiresInMs = (Number(code.expiresIn) || 900) * 1000;
  const deadline = Date.now() + expiresInMs;
  const sep = verificationUri.includes('?') ? '&' : '?';
  const fullUri = `${verificationUri}${sep}userCode=${encodeURIComponent(code.userCode)}`;

  // 2. Tell the user (and best-effort open the browser).
  process.stdout.write(
    `\nTo sign in, open this URL in your browser and approve the code:\n\n` +
      `  ${fullUri}\n\n` +
      `  Code: ${code.userCode}\n\n` +
      `Waiting for you to approve…\n`
  );
  openBrowser(fullUri);

  // 3. Poll for approval, honoring the interval + authorization_pending.
  let wait = interval;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new LoginError('Sign-in timed out before you approved it. Run login again to retry.');
    }
    await sleep(wait);
    const { res, json } = await postJson(`${base}/cli/device/token`, { deviceCode: code.deviceCode });
    if (res.ok && json.idToken && json.refreshToken) {
      const expiresInSec = parseInt(json.expiresIn, 10) || 3600;
      return {
        idToken: json.idToken,
        refreshToken: json.refreshToken,
        expiresAt: Date.now() + expiresInSec * 1000,
        email: json.email || undefined,
        uid: json.uid,
      };
    }
    const err = json.error || '';
    if (res.status === 428 || err === 'authorization_pending') {
      continue; // not approved yet — keep polling at the same interval
    }
    if (res.status === 429 || err === 'slow_down') {
      wait += 5000; // back off per RFC 8628
      continue;
    }
    if (err === 'expired_token' || res.status === 400 || res.status === 410) {
      throw new LoginError('The sign-in request expired. Run login again to retry.');
    }
    throw new LoginError(`Sign-in failed (HTTP ${res.status})${err ? `: ${err}` : ''}.`);
  }
}

async function main() {
  try {
    const { mode } = parseArgs(process.argv.slice(2));
    if (mode === 'help') {
      process.stdout.write('Usage: node bin/login.mjs [--sso]\n');
      process.exit(0);
    }

    const config = await getConfig();
    const creds = await ssoLogin(config);
    await saveCreds(creds);
    process.stdout.write(`Logged in as ${creds.email || creds.uid}\n`);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof LoginError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
