/** Machine-readable failures shared by the NativeUI CLI library and MCP server. */
export class ServiceError extends Error {
  constructor(code, message, remedy = '') {
    super(message);
    this.name = 'ServiceError';
    this.code = code || 'SERVICE_REJECTED';
    this.remedy = remedy;
  }
}

export const ErrorCode = Object.freeze({
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  EXPORT_ONLY_MODE: 'EXPORT_ONLY_MODE',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  SERVICE_REJECTED: 'SERVICE_REJECTED',
  INVALID_PROJECT: 'INVALID_PROJECT',
  LOGIN_EXPIRED: 'LOGIN_EXPIRED',
});

export function serviceError(error, fallback = ErrorCode.SERVICE_REJECTED) {
  if (error instanceof ServiceError) return error;
  const code = error?.code === 'revision_mismatch' ? ErrorCode.REVISION_CONFLICT
    : error?.code === ErrorCode.NOT_LOGGED_IN ? ErrorCode.NOT_LOGGED_IN
      : fallback;
  return new ServiceError(code, error?.message || String(error));
}
