import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import SalvexLogo from './SalvexLogo';
import './LoginPage.css';
import './AuthPages.css';
import './AuthShell.css';

/**
 * The layout shared by the sign-in, registration, verification and password pages: a plain brand
 * panel with the logo (wide screens only) beside the form card.
 */
export default function AuthShell({ title, subtitle, children, footer, className = '' }) {
  return (
    <div className={`salvex-login-page auth-split ${className}`.trim()}>
      <div className="auth-frame">
        <aside className="auth-aside" aria-hidden="true">
          <div className="auth-aside-glow" />
          <SalvexLogo variant="light" height={96} />
          <p className="auth-aside-name">Salvex Auction</p>
        </aside>

        <div className="login-card-container">
          <div className="login-header">
            <div className="login-logo-wrap">
              <SalvexLogo variant="light" height={36} />
            </div>
            <h1 className="login-title">{title}</h1>
            {subtitle && <p className="login-subtitle">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="login-footer">{footer}</div>}
        </div>
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
