// Where each kind of user lands after signing in. This is navigation only: the backend decides
// what a user is actually allowed to do.
export function homeForRole(role) {
  if (role === 'admin') return '/admin';
  if (role === 'seller') return '/seller/dashboard';
  return '/dashboard';
}

const AUTH_PAGES = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password'];

/** Only follow return-to paths that stay on this site and are not the sign-in pages themselves. */
export function safeReturnPath(from) {
  const path = from && typeof from === 'object' ? from.pathname : null;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  if (AUTH_PAGES.includes(path)) return null;
  return `${path}${from.search || ''}`;
}
