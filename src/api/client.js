// The single place the website talks to the backend.
//  - sends the HttpOnly session cookie (credentials: 'include') and, for state-changing calls,
//    the per-session CSRF token that the backend gave us (kept in memory only);
//  - turns every failure into one ApiError shape the screens can react to;
//  - never logs request or response bodies (they can contain passwords and one-time codes).

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor({ status, code, message, fieldErrors = {}, retryAfter = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;           // HTTP status, or 0 when the server could not be reached
    this.code = code;               // machine-readable, e.g. 'invalid_credentials'
    this.fieldErrors = fieldErrors; // { fieldName: 'message' } for validation (422) errors
    this.retryAfter = retryAfter;   // seconds, for rate limits
  }
}

let csrfToken = null;
export function setCsrfToken(token) {
  csrfToken = token || null;
}

const unauthorizedListeners = new Set();
/** Called when an authenticated request is rejected with 401 (for example an expired session). */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function buildError(response, data) {
  const status = response.status;
  const code = data && typeof data.code === 'string' ? data.code : `http_${status}`;
  const retryAfter = Number(response.headers.get('Retry-After')) || null;
  const fieldErrors = {};
  let message;

  if (Array.isArray(data?.detail)) {
    for (const item of data.detail) {
      const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
      if (field && field !== 'body' && !fieldErrors[field]) fieldErrors[field] = String(item.msg || 'Invalid value.');
    }
    message = 'Please correct the highlighted fields.';
  } else if (status === 429) {
    message = retryAfter
      ? `Too many attempts. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} and try again.`
      : 'Too many attempts. Please wait a little and try again.';
  } else if (status >= 500) {
    message = 'Something went wrong on our side. Please try again in a moment.';
  } else if (typeof data?.detail === 'string') {
    message = data.detail;
  } else {
    message = 'The request could not be completed.';
  }
  return new ApiError({ status, code, message, fieldErrors, retryAfter });
}

export async function apiRequest(path, { method = 'GET', body, notifyUnauthorized = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server. Check your internet connection and try again.',
    });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.ok) return data;

  const error = buildError(response, data);
  if (response.status === 401 && notifyUnauthorized) {
    unauthorizedListeners.forEach((listener) => listener(error));
  }
  throw error;
}
