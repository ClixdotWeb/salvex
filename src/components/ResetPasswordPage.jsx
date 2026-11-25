import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Mail, Eye, EyeOff, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { forgotPassword, resetPassword } from '../api/auth';
import PasswordStrengthMeter from './PasswordStrengthMeter';

const RESEND_WAIT_SECONDS = 60;

export default function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [info, setInfo] = useState(location.state?.message || null);
  const [wait, setWait] = useState(location.state?.justRequested ? RESEND_WAIT_SECONDS : 0);

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
    const problems = {};
    if (!email.trim()) problems.email = 'Enter your email address.';
    if (!/^\d{6}$/.test(code)) problems.code = 'Enter the 6-digit code from the email.';
    if (password.length < 8) problems.password = 'Use at least 8 characters.';
    else if (password.length > 128) problems.password = 'Use at most 128 characters.';
    else if (password.toLowerCase() === email.trim().toLowerCase()) problems.password = 'The password must not be your email address.';
    if (confirm !== password) problems.confirm = 'The two passwords do not match.';
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      await resetPassword(email.trim(), code, password);
      navigate('/login', {
        replace: true,
        state: { email: email.trim(), notice: 'Your password has been changed and you were signed out everywhere. Sign in with your new password.' },
      });
    } catch (err) {
      setFieldErrors({ ...(err.fieldErrors?.new_password ? { password: err.fieldErrors.new_password } : {}) });
      setError({ message: err.message, code: err.code });
      if (err.code === 'invalid_code' || err.code === 'code_locked') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (wait > 0) return;
    if (!email.trim()) {
      setFieldErrors({ email: 'Enter your email address first.' });
      return;
    }
    setError(null);
    try {
      const response = await forgotPassword(email.trim());
      setInfo(response.message);
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setError({ message: err.message, code: err.code });
      if (err.retryAfter) setWait(err.retryAfter);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Enter the 6-digit code we emailed you and your new password. The code expires in 15 minutes and works once."
      footer={<p><Link to="/login" className="link-register">Back to sign in</Link></p>}
    >
      {info && <Alert kind="success">{info}</Alert>}
      {error && (
        <Alert kind="error">
          {error.message}
          {error.code === 'code_locked' && ' Use "Send a new code" below.'}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <Field id="reset-email" label="Email address" error={fieldErrors.email}>
          <div className="input-with-icon">
            <Mail size={16} />
            <input id="reset-email" name="email" type="email" autoComplete="email" autoCapitalize="none"
              spellCheck={false} inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>

        <Field id="reset-code" label="Reset code" error={fieldErrors.code}>
          <div className="input-with-icon">
            <KeyRound size={16} />
            <input id="reset-code" name="code" type="text" className="code-input" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" required placeholder="000000"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </div>
        </Field>

        <Field id="reset-password" label="New password" error={fieldErrors.password}
          hint="At least 8 characters. Avoid common passwords; a short phrase works well.">
          <div className="input-with-icon">
            <Lock size={16} />
            <input id="reset-password" name="new-password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" required maxLength={128} value={password}
              aria-describedby="reset-password-hint" onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn-toggle-eye" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <PasswordStrengthMeter password={password} email={email} id="reset-password-strength" />
        </Field>

        <Field id="reset-confirm" label="Confirm new password" error={fieldErrors.confirm}>
          <div className="input-with-icon">
            <Lock size={16} />
            <input id="reset-confirm" name="confirm-password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" required maxLength={128} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </Field>

        <button type="submit" disabled={busy} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Saving…</span> : (<><span>Change password</span><ArrowRight size={15} /></>)}
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
