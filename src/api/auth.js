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

/** A correct code also signs the user in (HttpOnly cookie). Resolves with the signed-in user. */
export async function verifyEmail(email, otp) {
  const data = await apiRequest('/api/auth/verify-email', { method: 'POST', body: { email, otp }, ...PUBLIC });
  setCsrfToken(data.csrf_token); // memory only, exactly as after login
  return data.user;
}

/** Sign-up with mobile verification on: the SMS code creates the account and signs the user in. */
export async function verifySignupMobile(email, otp) {
  const data = await apiRequest('/api/auth/verify-mobile', { method: 'POST', body: { email, otp }, ...PUBLIC });
  setCsrfToken(data.csrf_token);
  return data.user;
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

/** Signed in: send an SMS code to the current mobile number, or to a new number (which replaces it). */
export function sendMobileCode(mobile) {
  return apiRequest('/api/auth/mobile/send-code', { method: 'POST', body: mobile ? { mobile } : {} });
}

/** Signed in: confirm the mobile number with the SMS code. Resolves with the updated user. */
export function verifyMobile(otp) {
  return apiRequest('/api/auth/mobile/verify', { method: 'POST', body: { otp } });
}

/** Signed in: email a code to confirm the email address (buyers who signed up with the SMS code). */
export function sendEmailCode() {
  return apiRequest('/api/auth/email/send-code', { method: 'POST' });
}

/** Signed in: confirm the email address with the emailed code. Resolves with the updated user. */
export function verifyEmailCode(otp) {
  return apiRequest('/api/auth/email/verify', { method: 'POST', body: { otp } });
}
