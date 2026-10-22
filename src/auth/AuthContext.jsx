import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/auth';
import { onUnauthorized, setCsrfToken } from '../api/client';
import { DEMO_PERSONAS_ENABLED } from './demo';
import { AuthContext } from './useAuth';

// Who is signed in? The ONLY source of truth is the backend (GET /api/auth/me), reached with the
// HttpOnly session cookie. The user is kept in memory; nothing about the session is written to
// localStorage or sessionStorage, so a flag in browser storage can never make anyone "logged in".
//
// status: 'loading' (still asking the backend) | 'authenticated' | 'anonymous'

const RECHECK_MIN_INTERVAL_MS = 30000;

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null); // e.g. 'session_expired'
  const [demoRole, setDemoRole] = useState(null); // development-only, see ./demo.js
  const statusRef = useRef('loading');
  const lastCheckRef = useRef(0);
  const startedRef = useRef(false);

  const apply = useCallback((nextStatus, nextUser) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    setUser(nextUser);
  }, []);

  const refresh = useCallback(async () => {
    lastCheckRef.current = Date.now();
    try {
      apply('authenticated', await authApi.fetchMe());
    } catch (error) {
      if (statusRef.current === 'authenticated' && error.status === 0) {
        return; // a passing network problem says nothing about the session; keep what we know
      }
      // 401 = not signed in. At start-up, if the backend cannot be reached we cannot prove who
      // this is, so we never pretend to be signed in.
      if (statusRef.current === 'authenticated' && error.status === 401) setNotice('session_expired');
      apply('anonymous', null);
    }
  }, [apply]);

  // Restore the session once when the app starts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    refresh();
  }, [refresh]);

  // Any signed-in request that comes back 401 means the session ended (expired, revoked, signed out elsewhere).
  useEffect(
    () =>
      onUnauthorized(() => {
        if (statusRef.current === 'authenticated') {
          setCsrfToken(null);
          setNotice('session_expired');
          apply('anonymous', null);
        }
      }),
    [apply],
  );

  // When the person comes back to this tab, make sure the session is still valid.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        statusRef.current === 'authenticated' &&
        Date.now() - lastCheckRef.current > RECHECK_MIN_INTERVAL_MS
      ) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const signedInUser = await authApi.login(email, password);
      setNotice(null);
      setDemoRole(null);
      apply('authenticated', signedInUser);
      return signedInUser;
    },
    [apply],
  );

  /**
   * Ends the session on the server and clears everything on this device. The device is ALWAYS
   * signed out locally; `serverRevoked` says whether the server confirmed that the session was ended.
   */
  const logout = useCallback(async () => {
    let serverRevoked = true;
    try {
      await authApi.logout();
    } catch {
      serverRevoked = false;
    }
    setCsrfToken(null);
    setNotice(null);
    setDemoRole(null);
    apply('anonymous', null);
    return { serverRevoked };
  }, [apply]);

  const value = useMemo(
    () => ({
      status,
      user,
      notice,
      clearNotice: () => setNotice(null),
      login,
      logout,
      refresh,
      // Development-only shortcut for viewing sample screens; always null/no-op in real builds.
      demoRole: DEMO_PERSONAS_ENABLED ? demoRole : null,
      enterDemo: DEMO_PERSONAS_ENABLED ? setDemoRole : () => {},
    }),
    [status, user, notice, login, logout, refresh, demoRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
