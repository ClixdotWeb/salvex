import React, { useState } from 'react';
import { Ban, CheckCircle2, Receipt, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cancelOrder, confirmPayment, getAdminOrder, listOrders, rejectPayment } from '../api/admin';
import { ActionDialog, AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, dateTime, money, pickFilter, useLoad } from './ui';

const FILTERS = [
  { value: 'payment_submitted', label: 'Payments to verify' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'defaulted', label: 'Defaulted' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All' },
];
const LABEL = { awaiting_payment: 'awaiting payment', payment_submitted: 'to verify', paid: 'paid', defaulted: 'defaulted', cancelled: 'cancelled' };
const TONE = { awaiting_payment: 'pending', payment_submitted: 'submitted', paid: 'approved', defaulted: 'rejected', cancelled: 'draft' };

export default function AdminOrders({ deepLink = {}, onDeepLinkClose }) {
  const [status, setStatus] = useState(pickFilter(deepLink.status, FILTERS, 'payment_submitted'));
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(deepLink.id || null);
  const closeDetail = () => { setOpenId(null); if (deepLink.id) onDeepLinkClose?.(); };
  const [notice, setNotice] = useState(null);
  const list = useLoad(() => listOrders({ status, page, page_size: 25 }), [status, page]);

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Orders & payments</h2>
          <p className="adm-muted">Winners pay by bank transfer and enter the UTR. Match each UTR and amount with the bank statement, then confirm. Unpaid orders default automatically at their deadline.</p>
        </div>
      </div>
      <div className="adm-tabs">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" className={status === f.value ? 'active' : ''} onClick={() => { setStatus(f.value); setPage(1); }}>{f.label}</button>
        ))}
      </div>
      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No orders here.</Empty> : (
        <AdmTable>
            <thead><tr><th>Order</th><th>Vehicle</th><th>Buyer</th><th>Amount</th><th>Status</th><th>UTR</th><th>Due</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                  <td className="mono"><strong>{o.number}</strong></td>
                  <td>{o.vehicle_title}<div className="adm-muted small mono">{o.registration_number}</div></td>
                  <td>{o.buyer_name}<div className="adm-muted small">{o.buyer_mobile || o.buyer_email}</div></td>
                  <td><strong>{money(o.amount)}</strong></td>
                  <td><Badge value={TONE[o.status]} label={LABEL[o.status]} /></td>
                  <td className="mono">{o.utr || '—'}</td>
                  <td>{dateTime(o.due_at)}</td>
                  <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
      {openId && <OrderDetail id={openId} onClose={closeDetail} onChanged={(msg) => { setNotice(msg); list.reload(); }} />}
    </div>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const { data, error, loading, reload } = useLoad(() => getAdminOrder(id), [id]);
  const [dialog, setDialog] = useState(null);
  const [actionError, setActionError] = useState(null);

  if (!data) return <Modal title="Order" onClose={onClose}>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;
  const done = (msg) => { reload(); onChanged(msg); };

  return (
    <Modal title={`Order ${data.number}`} onClose={onClose}>
      <div className="adm-detail">
        <div className="adm-inline"><Badge value={TONE[data.status]} label={LABEL[data.status]} /></div>
        <dl className="adm-dl">
          <dt>Vehicle</dt><dd>{data.vehicle_title} · {data.registration_number}</dd>
          <dt>Buyer</dt><dd>{data.buyer_name}<br /><span className="adm-muted small">{data.buyer_email} · {data.buyer_mobile || 'no phone'}</span></dd>
          <dt>Amount</dt><dd><strong>{money(data.amount)}</strong></dd>
          <dt>Won</dt><dd>{dateTime(data.created_at)}</dd>
          <dt>Payment due</dt><dd>{dateTime(data.due_at)}</dd>
          <dt>Method</dt><dd>{data.payment_method ? 'Bank transfer' : '—'}</dd>
          <dt>UTR</dt><dd className="mono">{data.utr || '—'}</dd>
          <dt>Submitted</dt><dd>{dateTime(data.payment_submitted_at)}</dd>
          <dt>Paid</dt><dd>{dateTime(data.paid_at)}</dd>
          {data.status_reason && <><dt>Note</dt><dd>{data.status_reason}</dd></>}
        </dl>

        {data.status === 'payment_submitted' && (
          <div className="adm-alert adm-alert-warning"><span>Check the company bank statement for <strong>{money(data.amount)}</strong> with reference <strong className="mono">{data.utr}</strong> before confirming.</span></div>
        )}
        <ErrorBox message={actionError} />
        <div className="adm-actions-row">
          {['awaiting_payment', 'payment_submitted'].includes(data.status) && (
            <button type="button" className="adm-btn danger" onClick={() => setDialog({
              title: 'Cancel order', confirmLabel: 'Cancel order', danger: true,
              description: 'Use this when the sale cannot go ahead for a reason that is not the buyer’s fault. The buyer is not penalised and the vehicle can be auctioned again.',
              onConfirm: async ({ reason }) => { await cancelOrder(id, reason); done(`Order ${data.number} cancelled.`); },
            })}><Ban size={15} /> Cancel order</button>
          )}
          {data.status === 'payment_submitted' && (
            <>
              <button type="button" className="adm-btn" onClick={() => setDialog({
                title: 'Reject payment reference', confirmLabel: 'Send back to buyer',
                description: 'The buyer sees your reason and can enter the correct UTR before the deadline.',
                onConfirm: async ({ reason }) => { await rejectPayment(id, reason); done(`UTR rejected for ${data.number}.`); },
              })}><XCircle size={15} /> Reject UTR</button>
              <button type="button" className="adm-btn primary" onClick={async () => {
                if (!window.confirm(`Confirm that ${money(data.amount)} (UTR ${data.utr}) is in the bank account?`)) return;
                setActionError(null);
                try { await confirmPayment(id); done(`Payment confirmed for ${data.number}.`); } catch (err) { setActionError(err.message); }
              }}><CheckCircle2 size={15} /> Confirm payment received</button>
            </>
          )}
          {data.status === 'paid' && (
            <Link to={`/orders/${id}/receipt`} className="adm-btn"><Receipt size={15} /> Receipt</Link>
          )}
        </div>
      </div>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
