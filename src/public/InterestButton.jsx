import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Hand, Info, Loader2, Phone, X } from 'lucide-react';
import { READY_TO_LIFT_NOTE, expressInterest, listMyInterests } from '../api/readyToLift';
import { useAuth } from '../auth/useAuth';

// The signed-in buyer's earlier "I'm interested" requests, loaded once and shared by every button on the page.
let mine = null;
function loadMine() {
  if (!mine) mine = listMyInterests().then((rows) => new Set(rows.map((r) => r.vehicle_id))).catch(() => { mine = null; return new Set(); });
  return mine;
}
export function resetInterestCache() { mine = null; }

/**
 * "I'm interested" for a Ready to Lift vehicle: tells our team, who call the buyer.
 * Nothing is sent on the first tap: a confirmation window shows the conditions and the phone number we will call,
 * and the buyer must tick that they read them before sending.
 */
export default function InterestButton({ vehicleId, title, block }) {
  const { user, status } = useAuth();
  const location = useLocation();
  const [state, setState] = useState('idle');          // idle | confirm | sending | sent
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || user.role === 'admin') return undefined;
    let alive = true;
    loadMine().then((set) => { if (alive && set.has(vehicleId)) setState('sent'); });
    return () => { alive = false; };
  }, [user, vehicleId]);

  useEffect(() => {
    if (state !== 'confirm' && state !== 'sending') return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && state === 'confirm') setState('idle'); };
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';                 // the page behind the window does not scroll
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = before; };
  }, [state]);

  const cls = `pub-btn ${block ? 'block' : ''}`;
  if (status === 'loading') return <button type="button" className={cls} disabled><Loader2 size={15} className="pub-spin" /></button>;
  if (!user) {
    return <Link to="/login" state={{ from: location }} className={`${cls} primary`}><Hand size={16} /> I'm interested</Link>;
  }
  if (user.role === 'admin') return null;
  if (state === 'sent') {
    // the list card keeps it short; the vehicle page (block) also says what happens next
    return <div className={`pub-interest-sent ${block ? 'block' : ''}`}><CheckCircle2 size={16} /> {block ? 'Interest sent · our team will call you' : 'Interest sent'}</div>;
  }

  const ask = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAgreed(false);
    setError(null);
    setState('confirm');
  };
  const send = async () => {
    setState('sending');
    setError(null);
    try {
      await expressInterest(vehicleId);
      if (mine) mine = mine.then((set) => new Set([...set, vehicleId]));
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState('confirm');
    }
  };
  const busy = state === 'sending';

  return (
    <>
      <button type="button" className={`${cls} primary`} onClick={ask}>
        <Hand size={16} /> I'm interested
      </button>
      {(state === 'confirm' || busy) && createPortal(
        <div className="pub-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setState('idle'); }}>
          <div className="pub-modal pub-interest-confirm" role="dialog" aria-modal="true" aria-label="Confirm your interest">
            <div className="pub-interest-head">
              <h3>Confirm your interest</h3>
              <button type="button" className="pub-icon-close" aria-label="Close" disabled={busy} onClick={() => setState('idle')}><X size={18} /></button>
            </div>
            {title && <p className="pub-interest-vehicle">{title}</p>}
            <div className="pub-rtl-note"><Info size={18} /> <p>{READY_TO_LIFT_NOTE}</p></div>
            <p className="pub-interest-call">
              <Phone size={16} />
              {user.mobile
                ? <span>Our team will call you on <strong>{user.mobile}</strong> with the price and the next steps.</span>
                : <span>Our team will contact you at <strong>{user.email}</strong>. Add a mobile number in your dashboard so we can call you.</span>}
            </p>
            <label className="pub-interest-agree">
              <input type="checkbox" checked={agreed} disabled={busy} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read the conditions above and want Salvex to contact me about this vehicle.</span>
            </label>
            {error && <p className="pub-form-error" role="alert">{error}</p>}
            <div className="pub-modal-actions">
              <button type="button" className="pub-btn" disabled={busy} onClick={() => setState('idle')}>Cancel</button>
              <button type="button" className="pub-btn primary" disabled={!agreed || busy} onClick={send}>
                {busy ? <Loader2 size={15} className="pub-spin" /> : <Hand size={16} />} Send my interest
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
