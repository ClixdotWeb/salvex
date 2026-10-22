import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lock, Mail, User, Phone, Building, Eye, EyeOff, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field } from './AuthShell';
import { useAuth } from '../auth/useAuth';
import { homeForRole } from '../auth/roles';
import { register } from '../api/auth';

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

  if (f.confirm !== f.password) errors.confirm = 'The two passwords do not match.';

  const phone = f.mobile.trim();
  if (phone && !PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
    errors.mobile = 'Enter a valid mobile number (7 to 15 digits, optionally starting with +).';
  }

  const organization = f.organization.trim();
  if (organization.length > 255) errors.organization = 'Use at most 255 characters.';
  else if (/[<>]/.test(organization)) errors.organization = 'The organization must not contain < or >.';
  return errors;
}

const ROLES = [
  { value: 'bidder', title: 'Bidder', text: 'Buy vehicles and parts at auction.' },
  { value: 'seller', title: 'Seller', text: 'List vehicles and assets for auction.' },
];

export default function RegisterPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm: '', role: 'bidder', mobile: '', organization: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

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
        role: form.role,
        mobile: form.mobile.trim(),
        organization: form.organization.trim(),
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
      title="Create your Salvex account"
      subtitle="Register as a bidder or a seller. We will email you a 6-digit code to confirm your email address."
      footer={<p>Already have an account? <Link to="/login" className="link-register">Sign in</Link></p>}
    >
      {formError && <Alert kind="error">{formError}</Alert>}

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <fieldset className="role-fieldset">
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
        </fieldset>

        <Field id="reg-name" label="Full name or company name" error={errors.name}>
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

        <Field id="reg-password" label="Password" error={errors.password} hint="At least 8 characters. Avoid common passwords; a short phrase works well.">
          <div className="input-with-icon">
            <Lock size={16} />
            <input id="reg-password" name="password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" required maxLength={128} value={form.password}
              onChange={set('password')} aria-describedby="reg-password-hint" {...invalid('password')} />
            <button type="button" className="btn-toggle-eye" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <Field id="reg-confirm" label="Confirm password" error={errors.confirm}>
          <div className="input-with-icon">
            <Lock size={16} />
            <input id="reg-confirm" name="confirm" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" required maxLength={128} value={form.confirm}
              onChange={set('confirm')} {...invalid('confirm')} />
          </div>
        </Field>

        <Field id="reg-mobile" label={<>Mobile number <span className="auth-optional">(optional)</span></>} error={errors.mobile}>
          <div className="input-with-icon">
            <Phone size={16} />
            <input id="reg-mobile" name="mobile" type="tel" autoComplete="tel" inputMode="tel" maxLength={50}
              placeholder="+91 98765 43210" value={form.mobile} onChange={set('mobile')} {...invalid('mobile')} />
          </div>
        </Field>

        <Field id="reg-organization" label={<>Organization <span className="auth-optional">(optional)</span></>} error={errors.organization}>
          <div className="input-with-icon">
            <Building size={16} />
            <input id="reg-organization" name="organization" type="text" autoComplete="organization" maxLength={255}
              value={form.organization} onChange={set('organization')} {...invalid('organization')} />
          </div>
        </Field>

        <p className="auth-hint">
          Creating an account does not complete KYC. Identity verification is a separate step that you finish after signing in.
        </p>

        <button type="submit" disabled={busy} className="salvex-btn salvex-btn-primary btn-login-submit">
          {busy ? <span>Creating account…</span> : (<><span>Create account</span><ArrowRight size={15} /></>)}
        </button>
      </form>
    </AuthShell>
  );
}
