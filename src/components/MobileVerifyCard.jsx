import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Phone, Smartphone } from 'lucide-react';
import { sendMobileCode, verifyMobile } from '../api/auth';
import { useAuth } from '../auth/useAuth';
import './MobileVerifyCard.css';

const RESEND_WAIT_SECONDS = 60;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/**
 * For signed-in buyers whose mobile number is not confirmed yet (accounts made before SMS codes).
 * Bidding stays blocked until the number is confirmed with the SMS code.
 */
export default function MobileVerifyCard() {
  const { user, refresh } = useAuth();
  const [changing, setChanging] = useState(false);
  const [newMobile, setNewMobile] = useState('');
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

  if (!user || user.is_mobile_verified) return null;

  const handleSend = async () => {
    setError(null);
    setInfo(null);
    let mobile;
    if (changing) {
      mobile = newMobile.trim();
      if (!PHONE_PATTERN.test(mobile.replace(/[\s\-()]/g, ''))) {
        setError('Enter a valid mobile number (7 to 15 digits, optionally starting with +).');
        return;
      }
    }
    setBusy('send');
    try {
      const response = await sendMobileCode(mobile);
      setInfo(response.message);
      setSent(true);
      setWait(RESEND_WAIT_SECONDS);
      if (changing) {
        setChanging(false);
        await refresh(); // shows the new number
      }
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
      await verifyMobile(code);
      await refresh(); // the card disappears once the account shows the number as verified
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mv-card" aria-labelledby="mv-title">
      <div className="mv-head">
        <span className="mv-icon"><Smartphone size={20} aria-hidden="true" /></span>
        <div>
          <h3 id="mv-title">Verify your mobile number</h3>
          <p>We send a 6-digit code by SMS. You need a verified number to bid, so our team can reach you if you win.</p>
        </div>
      </div>

      {error && <p className="mv-alert mv-alert-error" role="alert">{error}</p>}
      {info && !error && <p className="mv-alert mv-alert-ok" role="status">{info}</p>}

      <div className="mv-number">
        <Phone size={16} aria-hidden="true" />
        <span>{user.mobile || 'No mobile number on your account'}</span>
        {!changing && (
          <button type="button" className="mv-link" onClick={() => { setChanging(true); setError(null); }}>
            {user.mobile ? 'Use a different number' : 'Add a number'}
          </button>
        )}
      </div>

      {changing && (
        <label className="mv-field">
          <span>New mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" maxLength={50} placeholder="+91 98765 43210"
            value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
        </label>
      )}

      <div className="mv-actions">
        <button type="button" className="salvex-btn salvex-btn-primary btn-sm" onClick={handleSend}
          disabled={busy !== null || (!changing && !user.mobile) || (wait > 0 && !changing)}>
          {busy === 'send' ? 'Sending…' : wait > 0 && !changing ? `Send again in ${wait}s` : sent ? 'Send a new code' : 'Send SMS code'}
        </button>
        {changing && (
          <button type="button" className="mv-link" onClick={() => { setChanging(false); setNewMobile(''); }}>Cancel</button>
        )}
      </div>

      {sent && (
        <form className="mv-verify" onSubmit={handleVerify} noValidate>
          <label className="mv-field">
            <span>SMS code</span>
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
