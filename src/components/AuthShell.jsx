import React from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import SalvexLogo from './SalvexLogo';
import './LoginPage.css';
import './AuthPages.css';

/** The card layout shared by the sign-in, registration, verification and password pages. */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="salvex-login-page">
      <div className="login-card-container">
        <div className="login-header">
          <div className="login-logo-wrap">
            <SalvexLogo variant="light" height={36} />
          </div>
          <span className="login-badge-secure">
            <ShieldCheck size={13} />
            Secure sign-in
          </span>
          <h1 className="login-title">{title}</h1>
          {subtitle && <p className="login-subtitle">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="login-footer">{footer}</div>}
      </div>
    </div>
  );
}

const ICONS = { error: AlertCircle, warning: AlertCircle, success: CheckCircle2, info: Info };

/** kind: 'error' | 'warning' | 'success' | 'info'. Errors are announced to screen readers immediately. */
export function Alert({ kind = 'info', children, ...rest }) {
  const Icon = ICONS[kind] || Info;
  const cssKind = kind === 'info' ? 'success' : kind;
  return (
    <div
      className={`login-alert-banner alert-${cssKind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      {...rest}
    >
      <Icon size={18} />
      <span>{children}</span>
    </div>
  );
}

/** A labelled form field with an optional hint and error message wired up for accessibility. */
export function Field({ id, label, error, hint, children }) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && (
        <span className="auth-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="auth-field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
