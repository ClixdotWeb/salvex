// Calls to the backend authentication endpoints (see backend/app/api/auth.py).
import { apiRequest, setCsrfToken } from './client';

// These calls are made before (or in order to) sign in, so a 401 is an expected answer, not an expired session.
const PUBLIC = { notifyUnauthorized: false };

export function register({ name, email, password, role, mobile, organization }) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: { name, email, password, role, mobile, organization },
    ...PUBLIC,
  });
}

export function verifyEmail(email, otp) {
  return apiRequest('/api/auth/verify-email', { method: 'POST', body: { email, otp }, ...PUBLIC });
}

export function resendCode(email, purpose = 'email_verification') {
  return apiRequest('/api/auth/resend-otp', { method: 'POST', body: { email, purpose }, ...PUBLIC });
}

export async function login(identifier, password) {
  const data = await apiRequest('/api/auth/login', { method: 'POST', body: { identifier, password }, ...PUBLIC });
  setCsrfToken(data.csrf_token); // memory only; the session itself lives in an HttpOnly cookie
  return data.user;
}

/** Restores a session after a page load. Resolves with the user, or rejects with a 401 ApiError. */
export async function fetchMe() {
  const data = await apiRequest('/api/auth/me', PUBLIC);
  setCsrfToken(data.csrf_token);
  const { csrf_token: _token, ...user } = data;
  return user;
}

export async function logout() {
  try {
    return await apiRequest('/api/auth/logout', { method: 'POST', ...PUBLIC });
  } finally {
    setCsrfToken(null);
  }
}

export function forgotPassword(email) {
  return apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email }, ...PUBLIC });
}

export function resetPassword(email, otp, newPassword) {
  return apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: { email, otp, new_password: newPassword },
    ...PUBLIC,
  });
}
