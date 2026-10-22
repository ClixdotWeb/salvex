import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Lock, Mail, Eye, EyeOff, ArrowRight, UserCheck, Building, ShieldCheck } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { useAuth } from '../auth/useAuth';
import { DEMO_PERSONAS_ENABLED } from '../auth/demo';
import { homeForRole, safeReturnPath } from '../auth/roles';

// What to tell the person for each answer the backend can give.
function describeLoginError(error) {
  switch (error.code) {
    case 'invalid_credentials':
      return { kind: 'error', message: 'Incorrect email address or password. Please check them and try again.' };
    case 'email_not_verified':
      return {
        kind: 'warning',
        message: 'Your email address has not been verified yet. Enter the 6-digit code we emailed you to continue.',
        needsVerification: true,
      };
    case 'account_suspended':
      return { kind: 'error', message: error.message };
    default:
      return { kind: 'error', message: error.message || 'Sign-in failed. Please try again.' };
  }
}

export default function LoginPage({ onShowToast }) {
  const { status, user, login, notice, clearNotice, enterDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const afterSignIn = (role) => safeReturnPath(location.state?.from) || homeForRole(role);

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        Checking your session…
      </div>
    );
  }

  // Already signed in: there is nothing to do on this page.
  if (status === 'authenticated' && user) {
    return <Navigate to={afterSignIn(user.role)} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    clearNotice();
    if (!email.trim() || !password) {
      setError({ kind: 'error', message: 'Enter your email address and your password.' });
      return;
    }
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password);
      if (onShowToast) onShowToast(`Welcome back, ${signedIn.name}!`);
    } catch (err) {
      setError(describeLoginError(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const openDemo = (role) => {
    enterDemo(role);
    if (onShowToast) onShowToast(`Demo screens only (${role}). You are not signed in.`);
    navigate(homeForRole(role));
  };

  const passedNotice = location.state?.notice;

  return (
    <AuthShell
      title="Sign In to Salvex Auction"
      subtitle="Access your bids, auctions, settlements and yard lifting passes."
      footer={
        <p>
          New to Salvex? <Link to="/register" className="link-register">Create an account</Link>
        </p>
      }
    >
      {passedNotice && <Alert kind="success">{passedNotice}</Alert>}
      {notice === 'session_expired' && (
        <Alert kind="warning">Your session has ended. Please sign in again.</Alert>
      )}
      {error && (
        <Alert kind={error.kind}>
          {error.message}
          {error.needsVerification && (
            <button
              type="button"
              className="auth-inline-action"
              onClick={() => navigate('/verify-email', { state: { email: email.trim() } })}
            >
              Enter verification code
            </button>
          )}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <Field id="login-email" label="Email address">
          <div className="input-with-icon">
            <Mail size={16} />
            <input
              type="email"
              id="login-email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </Field>

        <div className="form-group">
          <div className="label-with-link">
            <label htmlFor="login-pass">Password</label>
            <Link to="/forgot-password" state={{ email: email.trim() }} className="link-forgot">
              Forgot password?
            </Link>
          </div>
          <div className="input-with-icon">
            <Lock size={16} />
            <input
              type={showPassword ? 'text' : 'password'}
              id="login-pass"
              name="password"
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn-toggle-eye"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={busy} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? (
            <span>Signing in…</span>
          ) : (
            <>
              <span>Sign In</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {DEMO_PERSONAS_ENABLED && (
        <div className="demo-persona-section">
          <span className="demo-persona-title">Development only: open sample screens (no real sign-in)</span>
          <span className="demo-persona-warning">Shows mock data. Nothing here is authenticated.</span>
          <div className="demo-persona-grid">
            <button type="button" className="persona-btn" onClick={() => openDemo('bidder')}>
              <UserCheck size={14} className="text-auction-red" />
              <span>Sample bidder screens</span>
            </button>
            <button type="button" className="persona-btn" onClick={() => openDemo('seller')}>
              <Building size={14} className="text-info" />
              <span>Sample seller screens</span>
            </button>
            <button type="button" className="persona-btn" onClick={() => openDemo('admin')}>
              <ShieldCheck size={14} style={{ color: '#075BFF' }} />
              <span>Sample admin screens</span>
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
