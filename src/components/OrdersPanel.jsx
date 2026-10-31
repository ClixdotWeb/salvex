import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Copy, Landmark, Loader2, Receipt, Trophy } from 'lucide-react';
import { ORDER_STATUS, listMyOrders, submitBankTransfer } from '../api/orders';
import { clockOffset, formatLeft, useNow } from '../public/shared';
import './OrdersPanel.css';

const money = (v) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (v) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The buyer's won auctions and how to pay for them. Everything here comes from the server. */
export default function OrdersPanel({ onChange }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await listMyOrders();
      setOrders(data);
      setError(null);
      if (onChange) onChange(data);
    } catch (err) {
      setError(err.message);
    }
  }, [onChange]);
  useEffect(() => { load(); }, [load]);

  if (error && !orders) return <div className="kyc-alert kyc-alert-error"><AlertTriangle size={16} /> <span>{error}</span></div>;
  if (!orders) return <div className="kyc-panel kyc-loading"><Loader2 size={18} className="kyc-spin" /> Loading…</div>;
  if (orders.length === 0) {
    return (
      <div className="salvex-empty-state">
        <Trophy size={36} className="text-muted" />
        <h3>No wins yet</h3>
        <Link to="/auctions/live" className="salvex-btn salvex-btn-primary btn-sm">Browse live auctions</Link>
      </div>
    );
  }
  return <div className="orders-list">{orders.map((o) => <OrderCard key={o.id} order={o} onUpdated={load} />)}</div>;
}

function OrderCard({ order, onUpdated }) {
  if (order.online_payment === false) return <ManualOrderCard order={order} />;
  return <OnlineOrderCard order={order} onUpdated={onUpdated} />;
}

/** The client's flow: nothing to pay on the website; our team contacts the winner and records the service fee. */
function ManualOrderCard({ order }) {
  const cancelled = order.status === 'cancelled';
  const completed = order.status === 'paid';              // the admin marked the deal completed
  const pending = order.fee_pending === null || order.fee_pending === undefined ? null : Number(order.fee_pending);
  const settled = completed || pending === 0;
  const tone = cancelled ? 'grey' : settled ? 'green' : 'blue';
  return (
    <div className={`order-card tone-${tone}`}>
      <div className="order-head">
        <div>
          <span className="order-number">{order.number}</span>
          <h3>{order.vehicle_title}</h3>
          <span className="order-sub">{order.registration_number} · won {when(order.created_at)}</span>
        </div>
        <span className={`order-status tone-${tone}`}>{cancelled ? 'Cancelled' : completed ? 'Completed' : settled ? 'Service fee paid' : 'Won'}</span>
      </div>
      <div className="order-figures">
        <div><span>Winning bid</span><strong>{money(order.approved_amount ?? order.amount)}</strong></div>
        {order.service_fee !== null && order.service_fee !== undefined && (
          <>
            <div><span>Service fee</span><strong>{money(order.service_fee)}</strong></div>
            <div><span>Fee received</span><strong>{money(order.fee_received)}</strong></div>
            {pending > 0 && <div className="urgent"><span>Fee pending</span><strong>{money(pending)}</strong></div>}
          </>
        )}
      </div>
      {cancelled ? (
        <div className="order-note"><span>This purchase was cancelled{order.status_reason ? `: ${order.status_reason}` : ''}.</span></div>
      ) : (
        <div className={`order-note ${settled ? 'success' : 'info'}`}>
          {settled ? <CheckCircle2 size={16} /> : <Trophy size={16} />}
          <span>{completed
            ? 'Your purchase is complete. Thank you for buying with Salvex.'
            : settled
            ? 'Thank you. Our team will complete the documents and the handover with you.'
            : 'Congratulations! Our team will contact you to complete the purchase, the documents and the handover. You do not pay on the website.'}</span>
        </div>
      )}
    </div>
  );
}

function OnlineOrderCard({ order, onUpdated }) {
  const now = useNow(clockOffset(order.server_time));
  const left = new Date(order.due_at).getTime() - now;
  const status = ORDER_STATUS[order.status] || { label: order.status, tone: 'grey' };

  return (
    <div className={`order-card tone-${status.tone}`}>
      <div className="order-head">
        <div>
          <span className="order-number">{order.number}</span>
          <h3>{order.vehicle_title}</h3>
          <span className="order-sub">{order.registration_number} · won {when(order.created_at)}</span>
        </div>
        <span className={`order-status tone-${status.tone}`}>{status.label}</span>
      </div>

      <div className="order-figures">
        <div><span>Amount to pay</span><strong>{money(order.amount)}</strong></div>
        {order.status === 'awaiting_payment' && (
          <div className={left < 6 * 3600000 ? 'urgent' : ''}><span>Time left to pay</span>
            <strong><Clock size={15} /> {left > 0 ? formatLeft(left) : 'Deadline passed'}</strong>
            <em>Pay by {when(order.due_at)}</em></div>
        )}
        {order.status === 'paid' && <div><span>Paid on</span><strong>{when(order.paid_at)}</strong></div>}
      </div>

      {order.status_reason && order.status === 'awaiting_payment' && (
        <div className="order-note warning"><AlertTriangle size={16} /> <span>Your last payment reference could not be verified: {order.status_reason}. Please check it and enter it again.</span></div>
      )}

      {order.status === 'awaiting_payment' && <PayByBankTransfer order={order} onUpdated={onUpdated} />}

      {order.status === 'payment_submitted' && (
        <div className="order-note info"><Clock size={16} /> <span>We received your payment reference <strong>{order.utr}</strong> on {when(order.payment_submitted_at)}. Our team is matching it with the bank statement; this page updates when it is confirmed.</span></div>
      )}
      {order.status === 'paid' && (
        <div className="order-note success">
          <CheckCircle2 size={16} />
          <span>Payment confirmed. Our team will contact you to arrange the vehicle handover.</span>
          <Link to={`/orders/${order.id}/receipt`} className="salvex-btn salvex-btn-outline btn-sm"><Receipt size={14} /> Receipt</Link>
        </div>
      )}
      {order.status === 'defaulted' && (
        <div className="order-note danger"><AlertTriangle size={16} /> <span>The payment deadline passed, so this purchase was cancelled and bidding on your account is blocked. Please contact support.</span></div>
      )}
      {order.status === 'cancelled' && (
        <div className="order-note"><span>This order was cancelled by Salvex{order.status_reason ? `: ${order.status_reason}` : ''}.</span></div>
      )}
    </div>
  );
}

function PayByBankTransfer({ order, onUpdated }) {
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bank = order.bank;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitBankTransfer(order.id, utr);
      await onUpdated();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="order-pay">
      <h4><Landmark size={16} /> Pay by bank transfer (NEFT / RTGS / IMPS / UPI to account)</h4>
      {bank ? (
        <dl className="order-bank">
          <dt>Account name</dt><dd>{bank.account_name}</dd>
          <dt>Account number</dt><dd>{bank.account_number} <CopyButton text={bank.account_number} /></dd>
          <dt>IFSC</dt><dd>{bank.ifsc} <CopyButton text={bank.ifsc} /></dd>
          <dt>Bank</dt><dd>{bank.bank_name}{bank.branch ? `, ${bank.branch}` : ''}</dd>
          <dt>Amount</dt><dd><strong>{money(order.amount)}</strong></dd>
          <dt>Reference</dt><dd>{order.number} <CopyButton text={order.number} /></dd>
        </dl>
      ) : (
        <p className="order-muted">Our team will send you the company bank account details for this payment.</p>
      )}
      <form onSubmit={submit} className="order-utr">
        <label>
          <span>After paying, enter the UTR / transaction reference from your bank</span>
          <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. SBIN226100012345" maxLength={40} />
        </label>
        <button type="submit" className="salvex-btn salvex-btn-primary" disabled={busy || utr.trim().length < 6}>
          {busy && <Loader2 size={15} className="kyc-spin" />} I have paid
        </button>
      </form>
      {error && <p className="order-error" role="alert">{error}</p>}
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="order-copy" aria-label={`Copy ${text}`}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? <CheckCircle2 size={13} /> : <Copy size={13} />}
    </button>
  );
}
