import { scorePassword } from '../utils/passwordStrength';
import './PasswordStrengthMeter.css';

/**
 * Weak / Moderate / Strong indicator shown under a new-password field (client request, 2026-11-25).
 *
 * Advisory only: the server still decides whether a password is accepted, and this never blocks
 * the form. Nothing is rendered until the person has typed something, so an untouched form stays
 * quiet. The reading is announced politely for screen readers rather than on every keystroke.
 */
export default function PasswordStrengthMeter({ password, email = '', id = 'password-strength' }) {
  const { score, label, reason } = scorePassword(password, email);

  if (!score) return null;

  const tone = label.toLowerCase();   // weak | moderate | strong

  return (
    <div className={`pw-strength pw-strength-${tone}`} id={id}>
      <div className="pw-strength-bars" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span key={step} className={`pw-strength-bar${step <= score ? ' is-on' : ''}`} />
        ))}
      </div>
      <p className="pw-strength-text" role="status" aria-live="polite">
        <span className="pw-strength-label">{label}</span>
        {reason && <span className="pw-strength-reason"> — {reason}</span>}
      </p>
    </div>
  );
}
