import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Mail, ArrowRight, Smartphone } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { resendCode, verifyEmail, verifySignupMobile } from '../api/auth';
import { useSiteConfig } from '../api/site';
import { homeForRole } from '../auth/roles';
import { useAuth } from '../auth/useAuth';

const RESEND_WAIT_SECONDS = 60;

/**
 * The one code that finishes sign-up. With mobile verification on it is the SMS code (the email is
 * confirmed later from the dashboard); otherwise it is the email code.
 */
export default function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const site = useSiteConfig();
  const bySms = Boolean(site?.mobile_otp);
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
      setError({ message: bySms ? 'Enter the 6-digit code we sent by SMS.' : 'Enter the 6-digit code from the email.' });
      return;
    }
    setBusy(true);
    try {
      // A correct code signs the user in, so go straight to their dashboard (no second sign-in).
      const signedInUser = bySms ? await verifySignupMobile(email.trim(), code) : await verifyEmail(email.trim(), code);
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
      const response = await resendCode(email.trim(), bySms ? 'mobile_verification' : 'email_verification');
      setInfo(bySms ? 'If this account is waiting for its SMS code, a new one has been sent.' : response.message);
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setError({ message: err.message, code: err.code });
      if (err.retryAfter) setWait(err.retryAfter);
    }
  };

  const locked = error?.code === 'code_locked' || error?.code === 'mobile_code_locked';

  if (site === null) {
    return <div className="auth-loading" role="status" aria-live="polite">Loading…</div>;
  }

  return (
    <AuthShell
      title={bySms ? 'Verify your mobile number' : 'Verify your email'}
      subtitle={bySms
        ? 'Enter the 6-digit code we sent by SMS to your mobile. It expires in 10 minutes and works once.'
        : 'Enter the 6-digit code we emailed you. It expires in 10 minutes and works once.'}
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

        <Field id="verify-code" label={bySms ? 'SMS code' : 'Verification code'}>
          <div className="input-with-icon">
            {bySms ? <Smartphone size={16} /> : <KeyRound size={16} />}
            <input id="verify-code" name="code" type="text" className="code-input" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" required placeholder="000000"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </div>
        </Field>

        <button type="submit" disabled={busy || code.length !== 6} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Verifying…</span> : (<><span>{bySms ? 'Verify mobile' : 'Verify email'}</span><ArrowRight size={15} /></>)}
        </button>
      </form>

      <div className="auth-actions-row">
        <span className="auth-hint">{bySms ? 'Did not get the SMS? Check the number, or ask for a new code.' : 'Did not get the email? Check your spam folder.'}</span>
        <button type="button" className="auth-secondary-btn" onClick={handleResend} disabled={wait > 0}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
      </div>
    </AuthShell>
  );
}
