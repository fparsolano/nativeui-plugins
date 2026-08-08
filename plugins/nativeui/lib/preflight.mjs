import { getConfig, loadCreds } from './config.mjs';
import { getFreshToken, isExportOnly } from './auth.mjs';

export async function preflight() {
  const config = await getConfig();
  const creds = await loadCreds();
  if (!isExportOnly(config)) await getFreshToken();
  return { ok: true, email: creds?.email || null, exportOnly: isExportOnly(config), subscription: isExportOnly(config) ? 'not-applicable' : 'unknown' };
}
