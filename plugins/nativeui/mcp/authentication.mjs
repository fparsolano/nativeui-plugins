import { getConfig, loadCreds } from '../lib/config.mjs';
import { AuthError, getFreshToken, isExportOnly, logout, pollDeviceLogin, requireNativeUiAuthMode, startDeviceLogin } from '../lib/auth.mjs';
import { ErrorCode, ServiceError } from '../lib/errors.mjs';

function loginDetails(login) {
  return {
    deviceCode: login.deviceCode,
    userCode: login.userCode,
    verificationUri: login.verificationUri,
    fullUri: login.fullUri,
    expiresAt: login.expiresAt,
    intervalSeconds: Math.ceil(login.intervalMs / 1000),
    instructions: `Open ${login.fullUri}, approve code ${login.userCode}, then call nativeui_login_wait with the deviceCode.`,
    nextTool: 'nativeui_login_wait',
  };
}

function isAuthFailure(error) {
  return error instanceof AuthError || [ErrorCode.NOT_LOGGED_IN, ErrorCode.SESSION_EXPIRED].includes(error?.code);
}

/** One browser-login session per MCP process, shared by every protected tool. */
export function createAuthenticationFlow() {
  let pendingLogin = null;

  async function beginLogin() {
    if (pendingLogin && pendingLogin.expiresAt > Date.now()) return loginDetails(pendingLogin);
    pendingLogin = await startDeviceLogin();
    return loginDetails(pendingLogin);
  }

  async function ensureAuthenticated({ allowExportOnly = false, feature = 'This operation' } = {}) {
    const config = await getConfig();
    if (isExportOnly(config)) {
      if (allowExportOnly) return { exportOnly: true };
      requireNativeUiAuthMode(config, feature);
    }
    try {
      await getFreshToken();
      const creds = await loadCreds();
      return { authenticated: true, email: creds?.email || null };
    } catch (error) {
      if (!isAuthFailure(error)) throw error;
      const login = await beginLogin();
      const failure = new ServiceError(error.code || ErrorCode.NOT_LOGGED_IN,
        'NativeUI authentication is required before this operation can run.', login.instructions);
      failure.login = login;
      throw failure;
    }
  }

  async function status() {
    const [config, creds] = await Promise.all([getConfig(), loadCreds()]);
    if (isExportOnly(config)) {
      return { authenticated: true, loggedIn: Boolean(creds?.refreshToken), email: creds?.email || null,
        tokenExpiresAt: creds?.expiresAt || null, exportOnly: true, exportAuthMode: config.exportAuthMode,
        exportServiceUrl: config.exportServiceUrl };
    }
    try {
      await getFreshToken();
      return { authenticated: true, loggedIn: true, email: creds?.email || null,
        tokenExpiresAt: creds?.expiresAt || null, exportOnly: false, exportAuthMode: config.exportAuthMode,
        exportServiceUrl: config.exportServiceUrl };
    } catch (error) {
      if (!isAuthFailure(error)) throw error;
      return { authenticated: false, loggedIn: false, email: creds?.email || null,
        tokenExpiresAt: creds?.expiresAt || null, exportOnly: false, exportAuthMode: config.exportAuthMode,
        exportServiceUrl: config.exportServiceUrl, loginRequired: true,
        instructions: 'Call nativeui_login_start, present its browser URL and code to the user, then call nativeui_login_wait.' };
    }
  }

  async function waitForLogin(deviceCode, options) {
    const result = await pollDeviceLogin(deviceCode, options);
    if (result.status === 'complete') pendingLogin = null;
    return result;
  }

  async function signOut() {
    pendingLogin = null;
    return logout();
  }

  return { beginLogin, ensureAuthenticated, status, waitForLogin, signOut };
}
