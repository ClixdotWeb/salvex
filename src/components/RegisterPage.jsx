import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Lock, Mail, User, Phone, Eye, EyeOff, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { useAuth } from '../auth/useAuth';
import { homeForRole } from '../auth/roles';
import { useSiteConfig } from '../api/site';
import { register } from '../api/auth';
import PasswordStrengthMeter from './PasswordStrengthMeter';

// These rules mirror the backend (backend/app/schemas/auth.py and core/password_policy.py).
// The backend is the real gatekeeper; the checks here just save a round trip and give instant feedback.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

function validate(f) {
  const errors = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 100) errors.name = 'Enter your full name (2 to 100 characters).';
  else if (/[<>]/.test(name)) errors.name = 'The name must not contain < or >.';

  if (!EMAIL_PATTERN.test(f.email.trim())) errors.email = 'Enter a valid email address.';

  if (f.password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (f.password.length > 128) errors.password = 'Use at most 128 characters.';
  else if (f.password.trim() === '') errors.password = 'The password must not be only spaces.';
  else if (f.password.toLowerCase() === f.email.trim().toLowerCase()) errors.password = 'The password must not be your email address.';

  const phone = f.mobile.trim();
  if (!phone) errors.mobile = 'Enter your mobile number.';
  else if (!PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
    errors.mobile = 'Enter a valid mobile number (7 to 15 digits, optionally starting with +).';
  }
  return errors;
}

const ROLES = [
  { value: 'bidder', title: 'Bidder', text: 'Buy vehicles and parts at auction.' },
  { value: 'seller', title: 'Seller', text: 'List vehicles and assets for auction.' },
];

export default function RegisterPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // "Create a seller account" (from /sell) arrives with the seller option pre-selected.
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: location.state?.role === 'seller' ? 'seller' : 'bidder', mobile: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const site = useSiteConfig();
  const sellers = Boolean(site?.seller_accounts);

  if (status === 'loading') {
    return <div className="auth-loading" role="status" aria-live="polite">Checking your session…</div>;
  }
  if (status === 'authenticated' && user) return <Navigate to={homeForRole(user.role)} replace />;

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const invalid = (field) => (errors[field] ? { 'aria-invalid': 'true', 'aria-describedby': `reg-${field}-error` } : {});

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const response = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: sellers ? form.role : 'bidder',
        mobile: form.mobile.trim(),
        organization: '',
      });
      // The email travels in router state (memory), never in the URL.
      navigate('/verify-email', { state: { email: form.email.trim(), justRegistered: true, message: response.message } });
    } catch (error) {
      setErrors(error.fieldErrors || {});
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      className="auth-register"
      title="Create your Salvex account"
      subtitle={sellers
          ? 'Register as a bidder or a seller. We will email you a 6-digit code to confirm your email address.'
          : 'Register to bid on vehicles. We will email you a code to confirm your email.'}
      footer={<p>Already have an account? <Link to="/login" className="link-register">Sign in</Link></p>}
    >
      {formError && <Alert kind="error">{formError}</Alert>}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        {sellers && <fieldset className="role-fieldset">
          <legend>I want to</legend>
          <div className="role-options">
            {ROLES.map((option) => (
              <label key={option.value} className={`role-option ${form.role === option.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={form.role === option.value}
                  onChange={set('role')}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.text}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>}

        <div className="auth-register-grid">
          <Field id="reg-name" label="Full name" error={errors.name}>
            <div className="input-with-icon">
              <User size={16} />
              <input id="reg-name" name="name" type="text" autoComplete="name" required maxLength={100}
                value={form.name} onChange={set('name')} {...invalid('name')} />
            </div>
          </Field>

          <Field id="reg-email" label="Email address" error={errors.email}>
            <div className="input-with-icon">
              <Mail size={16} />
              <input id="reg-email" name="email" type="email" autoComplete="email" autoCapitalize="none"
                spellCheck={false} inputMode="email" required value={form.email} onChange={set('email')} {...invalid('email')} />
            </div>
          </Field>

          <Field id="reg-password" label="Password" error={errors.password} hint="At least 8 characters.">
            <div className="input-with-icon">
              <Lock size={16} />
              <input id="reg-password" name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" required maxLength={128} value={form.password}
                onChange={set('password')} aria-describedby="reg-password-hint" {...invalid('password')} />
              <button type="button" className="btn-toggle-eye" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <PasswordStrengthMeter password={form.password} email={form.email} id="reg-password-strength" />
          </Field>

          <Field id="reg-mobile" label="Mobile number" error={errors.mobile}>
            <div className="input-with-icon">
              <Phone size={16} />
              <input id="reg-mobile" name="mobile" type="tel" autoComplete="tel" inputMode="tel" maxLength={50}
                required placeholder="+91 98765 43210" value={form.mobile} onChange={set('mobile')} {...invalid('mobile')} />
            </div>
          </Field>

        </div>

        <button type="submit" disabled={busy} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Creating account…</span> : (<><span>Create account</span><ArrowRight size={15} /></>)}
        </button>
      </form>
    </AuthShell>
  );
}
