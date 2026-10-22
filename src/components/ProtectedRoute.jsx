import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { homeForRole } from '../auth/roles';

/**
 * ProtectedRoute
 * Waits for the backend to say who is signed in (GET /api/auth/me) BEFORE deciding anything, so
 * there is no redirect flash and no content is shown to someone who is not signed in.
 *
 * This guard only decides what the browser SHOWS. Real access control must be (and, as business
 * endpoints are added, will be) enforced by the backend on every request.
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { status, user, demoRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        Checking your session…
      </div>
    );
  }

  // `demoRole` is always null unless a developer explicitly enabled demo screens (see auth/demo.js).
  const role = user?.role ?? demoRole;

  if (!role) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    // Signed in, but this area is for someone else: send them to their own home.
    return <Navigate to={homeForRole(role)} replace />;
  }

  return children;
}
