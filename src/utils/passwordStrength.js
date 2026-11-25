/**
 * Password strength shown while a password is being typed (client request, 2026-11-25).
 *
 * This is a HINT, not the rule. The server decides whether a password is acceptable
 * (backend/app/core/password_policy.py) and the form still submits to it; this only tells the
 * person how their password is shaping up. The deny-list and length limits below mirror that
 * module, so "Weak" here matches what the server rejects. Keep the two in step when either
 * one changes.
 */

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

// Mirrors _COMMON_PASSWORDS in the backend policy.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', '123123123',
  'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'abcd1234', 'abc12345',
  'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator', 'changeme',
  'football', 'baseball', 'monkey123', 'dragon123', 'sunshine', 'princess', 'trustno1',
  'salvex123', 'salvex@123', 'salvexauction',
]);

// Mirrors _COMMON_STEMS: still weak once digits or symbols are tacked on the end.
const COMMON_STEMS = new Set([
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwertyuiop', 'qwertyui', 'admin',
  'administrator', 'welcome', 'letmein', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'sunshine', 'princess', 'trustno', 'changeme', 'abc', 'abcd', 'abcdef', 'login', 'master',
  'test', 'testing', 'secret', 'salvex', 'salvexauction', 'auction', 'bidder', 'seller',
]);

const TRAILING = '0123456789!@#$%^&*._-';

function stripTrailing(value) {
  let end = value.length;
  while (end > 0 && TRAILING.includes(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

/** True when the server's deny-list would reject this password outright. */
function isCommon(password) {
  const lower = password.toLowerCase();
  return COMMON_PASSWORDS.has(lower) || COMMON_STEMS.has(stripTrailing(lower));
}

/**
 * Scores a password as 'weak' | 'moderate' | 'strong'.
 *
 * Returns `{ score, label, reason, acceptable }` where `acceptable` means the server policy
 * would let it through. `reason` is a short nudge, or null when there is nothing to say.
 * An empty password returns score 0 so the caller can hide the meter entirely.
 */
export function scorePassword(password, email = '') {
  const value = password || '';

  if (!value) return { score: 0, label: '', reason: null, acceptable: false };

  if (value.trim() === '') {
    return { score: 1, label: 'Weak', reason: 'Password must not be only spaces.', acceptable: false };
  }
  if (value.length < MIN_LENGTH) {
    return {
      score: 1,
      label: 'Weak',
      reason: `Use at least ${MIN_LENGTH} characters.`,
      acceptable: false,
    };
  }
  if (value.length > MAX_LENGTH) {
    return {
      score: 1,
      label: 'Weak',
      reason: `Use at most ${MAX_LENGTH} characters.`,
      acceptable: false,
    };
  }
  if (isCommon(value)) {
    return {
      score: 1,
      label: 'Weak',
      reason: 'This password is too common. Choose a different one.',
      acceptable: false,
    };
  }
  if (email && value.toLowerCase() === email.trim().toLowerCase()) {
    return {
      score: 1,
      label: 'Weak',
      reason: 'Password must not be the same as your email address.',
      acceptable: false,
    };
  }

  // Past this point the server would accept it; the rest is advice on how hard it is to guess.
  // Length does most of the work, so it carries most of the weight.
  let points = 0;
  if (value.length >= 10) points += 1;
  if (value.length >= 14) points += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1;
  if (/\d/.test(value)) points += 1;
  if (/[^A-Za-z0-9]/.test(value)) points += 1;

  // A single repeated character or a plain run of letters/digits is easy to guess however long it is.
  if (/^(.)\1+$/.test(value) || /^(?:0123456789|abcdefghij)/i.test(value)) {
    return {
      score: 1,
      label: 'Weak',
      reason: 'Avoid repeated characters and simple sequences.',
      acceptable: true,
    };
  }

  if (points >= 4) {
    return { score: 3, label: 'Strong', reason: null, acceptable: true };
  }
  if (points >= 2) {
    return {
      score: 2,
      label: 'Moderate',
      reason: 'Add length, or mix in capitals, numbers or symbols.',
      acceptable: true,
    };
  }
  return {
    score: 1,
    label: 'Weak',
    reason: 'Make it longer, or mix in capitals, numbers or symbols.',
    acceptable: true,
  };
}
