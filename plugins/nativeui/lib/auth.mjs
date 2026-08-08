import { getConfig, loadCreds, saveCreds, clearCreds } from './config.mjs';
import { postJson, profileApiBase } from './http.mjs';
import { ErrorCode, ServiceError } from './errors.mjs';

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const LOGIN_REMEDY = 'Call nativeui_login_start and have the user approve the sign-in in their browser.';

export class AuthError extends ServiceError {
  constructor(message, code = ErrorCode.NOT_LOGGED_IN) { super(code, message, LOGIN_REMEDY); this.name = 'AuthError'; }
}

export function isExportOnly(config) { return config?.exportAuthMode === 'none'; }
export function exportOnlyUnavailable(feature) { return `${feature} is not available in export-only mode.`; }
export function requireNativeUiAuthMode(config, feature) {
  if (isExportOnly(config)) throw new AuthError(exportOnlyUnavailable(feature), ErrorCode.EXPORT_ONLY_MODE);
}

export async function refreshIdToken(config, creds) {
  const { response, json } = await postJson(`${profileApiBase(config)}/cli/session/refresh`, { refreshToken: creds.refreshToken });
  if (!response.ok || !json.idToken || !json.refreshToken) {
    const expired = ['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'missing_refresh_token'].includes(json?.code || json?.error);
    throw new AuthError(`NativeUI session refresh failed${json?.code ? `: ${json.code}` : ''}.`, expired ? ErrorCode.SESSION_EXPIRED : ErrorCode.NOT_LOGGED_IN);
  }
  const updated = { idToken: json.idToken, refreshToken: json.refreshToken || creds.refreshToken,
    expiresAt: Date.now() + (Number.parseInt(json.expiresIn, 10) || 3600) * 1000, email: json.email || creds.email, uid: json.uid || creds.uid };
  await saveCreds(updated);
  return updated;
}

export async function getFreshToken() {
  const config = await getConfig();
  const creds = await loadCreds();
  if (!creds?.refreshToken) throw new AuthError('Not logged in to NativeUI.');
  if (creds.idToken && creds.expiresAt - Date.now() >= REFRESH_SKEW_MS) return creds.idToken;
  return (await refreshIdToken(config, creds)).idToken;
}

export async function exportServiceHeaders(config, headers = {}) {
  return isExportOnly(config) ? { ...headers } : { ...headers, Authorization: `Bearer ${await getFreshToken()}` };
}

function sameOriginDeviceUri(serverUri, exportServiceUrl) {
  const fallback = `${exportServiceUrl}/device`;
  try { return serverUri && new URL(serverUri).host === new URL(exportServiceUrl).host ? serverUri : fallback; } catch { return fallback; }
}

export async function startDeviceLogin() {
  const config = await getConfig();
  const { response, json } = await postJson(`${profileApiBase(config)}/cli/device/code`, {});
  if (!response.ok || !json.deviceCode || !json.userCode) throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Could not start browser sign-in (HTTP ${response.status}).`);
  const verificationUri = sameOriginDeviceUri(json.verificationUri, config.exportServiceUrl);
  const fullUri = `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}userCode=${encodeURIComponent(json.userCode)}`;
  return { deviceCode: json.deviceCode, userCode: json.userCode, verificationUri, fullUri,
    intervalMs: Math.max(2, Number(json.interval) || 5) * 1000, expiresAt: Date.now() + (Number(json.expiresIn) || 900) * 1000 };
}

export async function pollDeviceLoginOnce(deviceCode) {
  const config = await getConfig();
  const { response, json } = await postJson(`${profileApiBase(config)}/cli/device/token`, { deviceCode });
  if (response.ok && json.idToken && json.refreshToken) {
    const creds = { idToken: json.idToken, refreshToken: json.refreshToken, expiresAt: Date.now() + (Number.parseInt(json.expiresIn, 10) || 3600) * 1000, email: json.email, uid: json.uid };
    await saveCreds(creds);
    return { status: 'complete', email: creds.email || creds.uid || '' };
  }
  const error = json.error || '';
  if (response.status === 428 || error === 'authorization_pending' || response.status === 429 || error === 'slow_down') return { status: 'pending', retry: true, slowDown: response.status === 429 || error === 'slow_down' };
  if (error === 'expired_token' || response.status === 400 || response.status === 410) throw new ServiceError(ErrorCode.LOGIN_EXPIRED, 'The sign-in request expired. Start login again.');
  throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Sign-in failed (HTTP ${response.status})${error ? `: ${error}` : ''}.`);
}

export async function pollDeviceLogin(deviceCode, { timeoutMs = 15 * 60 * 1000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pollDeviceLoginOnce(deviceCode);
    if (result.status === 'complete') return result;
    await new Promise((resolve) => setTimeout(resolve, result.slowDown ? intervalMs + 5000 : intervalMs));
  }
  return { status: 'pending', retry: true };
}

export async function logout() { await clearCreds(); return { loggedOut: true }; }
