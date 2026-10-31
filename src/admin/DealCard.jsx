import React, { useState } from 'react';
import { Ban, CheckCircle2, Pencil, Plus, Receipt } from 'lucide-react';
import { addFeePayment, cancelOrder, completeDeal, updateDeal } from '../api/admin';
import { ActionDialog, Badge, ErrorBox, dateTime, money } from './ui';
import DateTimePicker from '../components/ui/DateTimePicker';

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const isoDate = (value) => (value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '');
const shortDate = (value) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * The deal on a won auction. The client collects the vehicle price and the service fee outside the website;
 * the admin records here: approved amount / date, the service fee, and each amount of fee received.
 */
export function DealSummary({ deal, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const pending = deal.fee_pending === null ? null : Number(deal.fee_pending);
  const open = !['paid', 'cancelled'].includes(deal.status);
  const state = deal.status === 'cancelled' ? { tone: 'cancelled', label: 'Sale cancelled' }
    : deal.status === 'paid' ? { tone: 'approved', label: 'Deal completed' } : { tone: 'pending', label: 'In progress' };

  return (
    <div className="adm-card adm-deal">
      <div className="adm-card-head">
        <h4>Deal & service fee <Badge value={state.tone} label={state.label} /></h4>
        {!editing && deal.status !== 'cancelled' && <button type="button" className="adm-btn small" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>}
      </div>
      {!open && (
        <p className={`adm-alert ${deal.status === 'cancelled' ? 'adm-alert-warning' : 'adm-alert-success'}`}>
          {deal.status === 'cancelled'
            ? `Cancelled ${dateTime(deal.closed_at)}${deal.status_reason ? `: ${deal.status_reason}` : ''}. The vehicle is back under Auctions > Waiting for a new auction.`
            : `Completed ${dateTime(deal.closed_at)}${deal.status_reason && deal.status_reason !== 'Deal completed' ? `: ${deal.status_reason}` : ''}.`}
        </p>
      )}
      {editing ? (
        <DealForm deal={deal} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged('Deal updated.'); }} />
      ) : (
        <>
          <dl className="adm-dl">
            <dt>Order</dt><dd className="mono">{deal.order_number}</dd>
            <dt>Approved amount</dt><dd><strong>{money(deal.approved_amount)}</strong></dd>
            <dt>Approved date</dt><dd>{deal.approved_at ? dateTime(deal.approved_at).split(',').slice(0, 1).join('') : '—'}</dd>
            <dt>Service fee</dt><dd>{deal.service_fee === null ? <span className="adm-muted">Not set yet</span> : <strong>{money(deal.service_fee)}</strong>}</dd>
          </dl>
          <div className="adm-fee-totals">
            <div className="adm-fee-box received"><span>Fee received</span><strong>{money(deal.fee_received)}</strong></div>
            <div className={`adm-fee-box ${pending === null ? 'unset' : pending > 0 ? 'pending' : 'done'}`}>
              <span>Pending fee</span>
              <strong>{pending === null ? '—' : money(pending)}</strong>
              {pending === 0 && <em>Fully paid</em>}
            </div>
          </div>
          {deal.service_fee === null && <p className="adm-muted small">Set the service fee to start recording payments.</p>}
          {open && (
            <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="adm-btn small primary" onClick={() => setDialog({
                title: 'Mark deal completed', confirmLabel: 'Mark completed', reasonRequired: false, reasonLabel: 'Note',
                description: 'The buyer and the owner have finished the purchase. The buyer is told the purchase is complete.',
                onConfirm: async ({ reason }) => { await completeDeal(deal.order_id, reason || undefined); onChanged('Deal marked completed.'); },
              })}><CheckCircle2 size={14} /> Mark deal completed</button>
              <button type="button" className="adm-btn small danger" onClick={() => setDialog({
                title: 'Cancel sale', confirmLabel: 'Cancel sale', danger: true, reasonLabel: 'Why is the sale cancelled?',
                description: 'For example the winner withdrew. The buyer is told, and the vehicle goes back to Auctions > Waiting so you can auction it again.',
                onConfirm: async ({ reason }) => { await cancelOrder(deal.order_id, reason); onChanged('Sale cancelled. The vehicle is waiting for a new auction.'); },
              })}><Ban size={14} /> Cancel sale</button>
            </div>
          )}
        </>
      )}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DealForm({ deal, onCancel, onSaved }) {
  const [form, setForm] = useState({
    approved_amount: deal.approved_amount ? String(Number(deal.approved_amount)) : '',
    approved_on: isoDate(deal.approved_at),
    service_fee: deal.service_fee !== null ? String(Number(deal.service_fee)) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    const body = {};
    if (form.approved_amount !== '' && Number(form.approved_amount) !== Number(deal.approved_amount)) body.approved_amount = form.approved_amount;
    if (form.approved_on && form.approved_on !== isoDate(deal.approved_at)) body.approved_on = form.approved_on;
    if (form.service_fee !== '' && (deal.service_fee === null || Number(form.service_fee) !== Number(deal.service_fee))) body.service_fee = form.service_fee;
    if (Object.keys(body).length === 0) { onCancel(); return; }
    setBusy(true);
    setError(null);
    try { await updateDeal(deal.order_id, body); onSaved(); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form className="adm-form" onSubmit={save}>
      <label className="adm-field"><span>Approved amount (₹)</span>
        <input type="number" min="1" step="1" inputMode="numeric" value={form.approved_amount} onChange={(e) => set('approved_amount', e.target.value)} />
      </label>
      <label className="adm-field"><span>Approved date</span>
        <DateTimePicker mode="date" aria-label="Approved date" max={todayIso()} value={form.approved_on} onChange={(e) => set('approved_on', e.target.value)} />
      </label>
      <label className="adm-field"><span>Service fee (₹)</span>
        <input type="number" min="0" step="1" inputMode="numeric" value={form.service_fee} placeholder="e.g. 5000"
          onChange={(e) => set('service_fee', e.target.value)} />
      </label>
      <ErrorBox message={error} />
      <div className="adm-actions-row">
        <button type="button" className="adm-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="adm-btn primary" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

/** Every amount of service fee received (append-only). A mistake is fixed with a minus entry and a note. */
export function FeeEntries({ deal, onChanged }) {
  const [form, setForm] = useState({ amount: '', received_on: todayIso(), reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canAdd = deal.service_fee !== null;

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addFeePayment(deal.order_id, {
        amount: form.amount, received_on: form.received_on, reference: form.reference,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      setForm({ amount: '', received_on: todayIso(), reference: '', note: '' });
      onChanged('Fee received recorded. The buyer was notified.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-card">
      <div className="adm-card-head"><h4><Receipt size={15} /> Fee received</h4></div>
      {deal.payments.length === 0 ? <p className="adm-muted">No fee recorded yet.</p> : (
        <table className="adm-fee-table">
          <thead><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Note</th><th>Recorded by</th></tr></thead>
          <tbody>
            {deal.payments.map((p) => (
              <tr key={p.id} className={Number(p.amount) < 0 ? 'correction' : ''}>
                <td>{shortDate(p.received_on)}</td>
                <td><strong>{money(p.amount)}</strong></td>
                <td className="mono">{p.reference}</td>
                <td>{p.note || '—'}</td>
                <td className="adm-muted small">{p.created_by_name}<br />{dateTime(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAdd && (
        <form className="adm-fee-form" onSubmit={add}>
          <label className="adm-field"><span>Amount received (₹)</span>
            <input required type="number" step="1" inputMode="numeric" value={form.amount} placeholder="e.g. 3000"
              onChange={(e) => set('amount', e.target.value)} />
          </label>
          <label className="adm-field"><span>Received on</span>
            <DateTimePicker mode="date" required aria-label="Received on" max={todayIso()} value={form.received_on} onChange={(e) => set('received_on', e.target.value)} />
          </label>
          <label className="adm-field"><span>Reference no.</span>
            <input required maxLength={60} value={form.reference} placeholder="UTR / receipt no. / Cash" onChange={(e) => set('reference', e.target.value)} />
          </label>
          <label className="adm-field"><span>Note (for corrections)</span>
            <input maxLength={300} value={form.note} onChange={(e) => set('note', e.target.value)} />
          </label>
          <ErrorBox message={error} />
          <div className="adm-actions-row">
            <button type="submit" className="adm-btn primary" disabled={busy}><Plus size={14} /> Add fee received</button>
          </div>
        </form>
      )}
    </div>
  );
}
