import { ServiceError, ErrorCode } from './errors.mjs';

export function profileApiBase(config) {
  const override = (process.env.NATIVEUI_PROFILE_API_URL || '').replace(/\/+$/, '');
  return override || `${config.exportServiceUrl}/api/profile`;
}

export function bugsApiBase(config) {
  const override = (process.env.NATIVEUI_BUGS_API_URL || '').replace(/\/+$/, '');
  return override || `${config.exportServiceUrl}/api/bugs`;
}

export async function postJson(url, body, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  } catch (error) {
    throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Network error contacting ${url}: ${error.message}`);
  }
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { response, res: response, json, text };
}

export async function apiRequest(base, token, method, pathSuffix, body) {
  let response;
  try {
    response = await fetch(`${base}${pathSuffix}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Network error contacting profile service: ${error.message}`);
  }
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new ServiceError(ErrorCode.SERVICE_REJECTED, `Profile service returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (response.status === 409) {
    throw new ServiceError(ErrorCode.REVISION_CONFLICT,
      `Cloud project changed since last sync (revision ${json.revision ?? 'unknown'}). Pull first or save a new draft.`, 'Call nativeui_project_pull, resolve the change, then push again.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ServiceError(ErrorCode.SESSION_EXPIRED, 'Authentication rejected by profile service.', 'Call nativeui_login_start and approve the sign-in in your browser.');
  }
  if (!response.ok) throw new ServiceError(ErrorCode.SERVICE_REJECTED, `${method} ${pathSuffix} failed (HTTP ${response.status}): ${json.error || text.slice(0, 300)}`);
  return json;
}
