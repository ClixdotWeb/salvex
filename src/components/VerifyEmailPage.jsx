import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Mail, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { resendCode, verifyEmail } from '../api/auth';
import { homeForRole } from '../auth/roles';
import { useAuth } from '../auth/useAuth';

const RESEND_WAIT_SECONDS = 60;

/**
 * The code that finishes sign-up: always the one sent to the email address. (When bidding needs a
 * verified mobile, the buyer confirms it later from the dashboard.)
 */
export default function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(location.state?.message || null);
  // Right after registering a code has just been sent, so the resend button starts on cooldown.
  const [wait, setWait] = useState(location.state?.justRegistered ? RESEND_WAIT_SECONDS : 0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError({ message: 'Enter the email address you registered with.' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError({ message: 'Enter the 6-digit code from the email.' });
      return;
    }
    setBusy(true);
    try {
      // A correct code signs the user in, so go straight to their dashboard (no second sign-in).
      const signedInUser = await verifyEmail(email.trim(), code);
      adoptSession(signedInUser);
      navigate(homeForRole(signedInUser.role), { replace: true });
    } catch (err) {
      setError({ message: err.message, code: err.code });
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (wait > 0 || !email.trim()) {
      if (!email.trim()) setError({ message: 'Enter your email address first.' });
      return;
    }
    setError(null);
    try {
      const response = await resendCode(email.trim(), 'email_verification');
      setInfo(response.message);
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setError({ message: err.message, code: err.code });
      if (err.retryAfter) setWait(err.retryAfter);
    }
  };

  const locked = error?.code === 'code_locked';

  return (
    <AuthShell
      title="Verify your email"
      subtitle="Enter the 6-digit code we emailed you. It expires in 10 minutes and works once."
      footer={<p><Link to="/login" className="link-register">Back to sign in</Link></p>}
    >
      {info && <Alert kind="success">{info}</Alert>}
      {error && (
        <Alert kind="error">
          {error.message}
          {locked && ' Use "Send a new code" below.'}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <Field id="verify-email" label="Email address">
          <div className="input-with-icon">
            <Mail size={16} />
            <input id="verify-email" name="email" type="email" autoComplete="email" autoCapitalize="none"
              spellCheck={false} inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>

        <Field id="verify-code" label="Verification code">
          <div className="input-with-icon">
            <KeyRound size={16} />
            <input id="verify-code" name="code" type="text" className="code-input" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" required placeholder="000000"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </div>
        </Field>

        <button type="submit" disabled={busy || code.length !== 6} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Verifying…</span> : (<><span>Verify email</span><ArrowRight size={15} /></>)}
        </button>
      </form>

      <div className="auth-actions-row">
        <span className="auth-hint">Did not get the email? Check your spam folder.</span>
        <button type="button" className="auth-secondary-btn" onClick={handleResend} disabled={wait > 0}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
      </div>
    </AuthShell>
  );
}
