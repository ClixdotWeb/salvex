// Small shared pieces for the admin console. All data comes from the server; nothing here is sample data.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Car, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { ownPhotoUrl } from '../api/vehicles';

export const money = (value) => {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

/** The filter value from a link (?status=...) if it is one of the screen's filters, else the default. */
export const pickFilter = (value, filters, fallback) =>
  value !== null && value !== undefined && filters.some((f) => f.value === value) ? value : fallback;

/** "24 Oct, 11:05 am" (the year is added only when it is not this year). */
export const dateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit', hour12: true,
  });
};

/**
 * Admin table. On wide screens a normal table; on phones every row becomes a card, each value labelled
 * with its column heading (copied from <th> into data-label).
 */
export function AdmTable({ className = '', children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = [...table.querySelectorAll(':scope > thead th')].map((th) => th.textContent.trim());
    table.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        const label = heads[i] || '';
        if (td.dataset.label !== label) td.dataset.label = label;
      });
    });
  });
  return (
    <div className="adm-table-wrap">
      <table ref={ref} className={`adm-table ${className}`.trim()}>{children}</table>
    </div>
  );
}

/** Thumbnail + title + small line, for any list of vehicles. */
export function VehicleCell({ vehicleId, photoId, title, sub }) {
  return (
    <div className="adm-veh">
      <span className="adm-veh-thumb">
        {photoId ? <img src={ownPhotoUrl(vehicleId, photoId, 'thumb')} alt="" loading="lazy" /> : <Car size={18} />}
      </span>
      <span className="adm-veh-text">
        <strong title={title}>{title}</strong>
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}

/** Load data from the server; `reload()` fetches again. Keeps the previous data while reloading. */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(0);
  const run = useCallback(async () => {
    const ticket = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (ticket === latest.current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (ticket === latest.current) setState((s) => ({ ...s, error: err.message, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="adm-loading"><Loader2 size={18} className="adm-spin" /> {label}</div>;
}

export function ErrorBox({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="adm-alert adm-alert-error" role="alert">
      <AlertTriangle size={16} /> <span>{message}</span>
      {onRetry && <button type="button" className="adm-link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Notice({ kind = 'success', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`adm-alert adm-alert-${kind}`} role="status">
      <span>{children}</span>
      {onClose && <button type="button" className="adm-icon-btn" aria-label="Dismiss" onClick={onClose}><X size={14} /></button>}
    </div>
  );
}

const BADGE_TONES = {
  // KYC / vehicle review
  draft: 'grey', submitted: 'amber', changes_requested: 'amber', approved: 'green', rejected: 'red',
  // account
  pending: 'amber', verified: 'green', active: 'green', suspended: 'red',
  // auction phase / result
  upcoming: 'blue', live: 'green', closing: 'amber', paused: 'amber', ended: 'grey', cancelled: 'red',
  sold: 'green', no_sale: 'grey',
  // roles
  admin: 'navy', seller: 'blue', bidder: 'grey',
};

export function Badge({ value, label }) {
  if (!value) return null;
  return <span className={`adm-badge tone-${BADGE_TONES[value] || 'grey'}`}>{label || String(value).replace(/_/g, ' ')}</span>;
}

export function Pager({ page, onPage }) {
  if (!page || page.pages <= 1) return null;
  return (
    <div className="adm-pager">
      <button type="button" className="adm-icon-btn" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span>Page {page.page} of {page.pages} · {page.total} total</span>
      <button type="button" className="adm-icon-btn" disabled={page.page >= page.pages} onClick={() => onPage(page.page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, onTop }) {
  const backdrop = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const all = document.querySelectorAll('.adm-modal-backdrop');
      if (all[all.length - 1] === backdrop.current) onClose();      // only the window on top
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const dialog = (
    <div ref={backdrop} className={`adm-modal-backdrop${onTop ? ' on-top' : ''}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`adm-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="adm-modal-head">
          <h3>{title}</h3>
          <button type="button" className="adm-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-modal-body">{children}</div>
      </div>
    </div>
  );
  // a window opened from another window goes to the page body, so it is never clipped by the first one
  return onTop ? createPortal(dialog, document.body) : dialog;
}

/**
 * Asks for a reason (and optional extra fields) and runs `onConfirm(values)`. Server errors are shown
 * inside the dialog; it closes only when the action succeeded.
 */
export function ActionDialog({ title, description, confirmLabel = 'Confirm', danger, reasonRequired = true,
  reasonLabel = 'Reason (kept on record)', extra, initial = {}, onConfirm, onClose }) {
  const [values, setValues] = useState({ reason: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (reasonRequired && values.reason.trim().length < 3) { setError('Please write a reason (at least 3 characters).'); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ ...values, reason: values.reason.trim() });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="adm-form">
        {description && <p className="adm-muted">{description}</p>}
        {extra && extra(values, set)}
        {reasonLabel && (
          <label className="adm-field">
            <span>{reasonLabel}{reasonRequired ? '' : ' (optional)'}</span>
            <textarea rows={3} maxLength={500} value={values.reason} onChange={(e) => set('reason', e.target.value)} />
          </label>
        )}
        <ErrorBox message={error} />
        <div className="adm-actions-row">
          <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className={`adm-btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>
            {busy && <Loader2 size={14} className="adm-spin" />} {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Empty({ children }) {
  return <div className="adm-empty">{children}</div>;
}
