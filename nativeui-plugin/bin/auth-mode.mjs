// auth-mode.mjs — shared NativeUI hosted-auth vs export-only helpers.

import { getFreshToken, AuthError } from './token.mjs';

export function isExportOnly(config) {
  return config && config.exportAuthMode === 'none';
}

export function exportOnlyUnavailable(feature) {
  return (
    `${feature} is not available in export-only mode.\n` +
    `  exportAuthMode="none" is only for approved internal/self-hosted export services.\n` +
    `  Switch exportAuthMode back to "nativeui" to use NativeUI cloud account features.`
  );
}

export function requireNativeUiAuthMode(config, feature) {
  if (isExportOnly(config)) throw new AuthError(exportOnlyUnavailable(feature));
}

export async function getNativeUiToken(config, feature) {
  requireNativeUiAuthMode(config, feature);
  return await getFreshToken();
}

export async function exportServiceHeaders(config, headers = {}) {
  if (isExportOnly(config)) return { ...headers };
  const token = await getFreshToken();
  return { ...headers, Authorization: `Bearer ${token}` };
}

export function exportServiceRejectedAuthMessage(config, action) {
  if (isExportOnly(config)) {
    return (
      `${action} was rejected by the export service.\n` +
      `  exportAuthMode="none" omits NativeUI bearer auth; confirm the internal export service allows this client, ` +
      `or switch back to exportAuthMode="nativeui".`
    );
  }
  return `${action} rejected by export service.\n  Run: node bin/login.mjs`;
}
