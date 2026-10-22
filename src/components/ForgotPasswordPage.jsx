import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { forgotPassword } from '../api/auth';

export default function ForgotPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(location.state?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim()) {
      setError('Enter the email address of your account.');
      return;
    }
    setBusy(true);
    try {
      const response = await forgotPassword(email.trim());
      // The answer is the same whether or not the address has an account, so we always continue.
      navigate('/reset-password', { state: { email: email.trim(), message: response.message, justRequested: true } });
    } catch (err) {
      setError(err.fieldErrors?.email || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email address. If it belongs to an account, we will email you a 6-digit code to choose a new password."
      footer={<p><Link to="/login" className="link-register">Back to sign in</Link></p>}
    >
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <Field id="forgot-email" label="Email address">
          <div className="input-with-icon">
            <Mail size={16} />
            <input id="forgot-email" name="email" type="email" autoComplete="email" autoCapitalize="none"
              spellCheck={false} inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <button type="submit" disabled={busy} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Sending…</span> : (<><span>Send reset code</span><ArrowRight size={15} /></>)}
        </button>
      </form>
    </AuthShell>
  );
}
