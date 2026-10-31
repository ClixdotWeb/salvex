import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Mail, MailCheck } from 'lucide-react';
import { sendEmailCode, verifyEmailCode } from '../api/auth';
import { useAuth } from '../auth/useAuth';
import './MobileVerifyCard.css';

const RESEND_WAIT_SECONDS = 60;

/**
 * For buyers who signed up with the SMS code: confirm the email address, where receipts, KYC decisions
 * and password resets are sent. Bidding stays blocked until it is confirmed.
 */
export default function EmailVerifyCard() {
  const { user, refresh } = useAuth();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  if (!user || user.is_email_verified) return null;

  const handleSend = async () => {
    setError(null);
    setInfo(null);
    setBusy('send');
    try {
      const response = await sendEmailCode();
      setInfo(`${response.message} Check your spam folder if you do not see it.`);
      setSent(true);
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setError(err.message);
      if (err.code === 'code_cooldown') setSent(true);
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    setBusy('verify');
    try {
      await verifyEmailCode(code);
      await refresh(); // the card disappears once the account shows the email as verified
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mv-card" aria-labelledby="ev-title">
      <div className="mv-head">
        <span className="mv-icon"><MailCheck size={20} aria-hidden="true" /></span>
        <div>
          <h3 id="ev-title">Verify your email address</h3>
          <p>We email you a 6-digit code. Receipts, KYC decisions and password resets are sent here, so you need a verified email to bid.</p>
        </div>
      </div>

      {error && <p className="mv-alert mv-alert-error" role="alert">{error}</p>}
      {info && !error && <p className="mv-alert mv-alert-ok" role="status">{info}</p>}

      <div className="mv-number">
        <Mail size={16} aria-hidden="true" />
        <span>{user.email}</span>
      </div>

      <div className="mv-actions">
        <button type="button" className="salvex-btn salvex-btn-primary btn-sm" onClick={handleSend} disabled={busy !== null || wait > 0}>
          {busy === 'send' ? 'Sending…' : wait > 0 ? `Send again in ${wait}s` : sent ? 'Send a new code' : 'Email me a code'}
        </button>
      </div>

      {sent && (
        <form className="mv-verify" onSubmit={handleVerify} noValidate>
          <label className="mv-field">
            <span>Email code</span>
            <div className="mv-code">
              <KeyRound size={16} aria-hidden="true" />
              <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" placeholder="000000"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </div>
          </label>
          <button type="submit" className="salvex-btn salvex-btn-primary btn-sm" disabled={busy !== null || code.length !== 6}>
            {busy === 'verify' ? 'Verifying…' : (<>Verify <ArrowRight size={15} aria-hidden="true" /></>)}
          </button>
        </form>
      )}
    </section>
  );
}
