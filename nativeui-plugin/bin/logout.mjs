// logout.mjs — 'nativeui logout'.
//
// Removes the cached credentials at ~/.nativeui/credentials.json. Config is left
// in place. No error if there was nothing to remove (idempotent).
//
// Usage:  node bin/logout.mjs

import { clearCreds, loadCreds, CREDS_PATH } from './config.mjs';

async function main() {
  try {
    const existing = await loadCreds();
    await clearCreds();
    if (existing && existing.email) {
      process.stdout.write(`Logged out ${existing.email} (removed ${CREDS_PATH}).\n`);
    } else {
      process.stdout.write('Not logged in — nothing to remove.\n');
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Logout failed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

main();
