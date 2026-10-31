import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2, Printer } from 'lucide-react';
import { getOrder } from '../api/orders';
import { useAuth } from '../auth/useAuth';
import './OrdersPanel.css';

const money = (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (v) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Payment receipt for a paid order: printable, and "Save as PDF" from the browser's print dialog.
 * This is a payment receipt, NOT a GST tax invoice - that needs the company's GSTIN and its CA's format.
 */
export default function ReceiptPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { getOrder(id).then(setOrder).catch((err) => setError(err.message)); }, [id]);

  if (error) return <div className="receipt-page"><div className="receipt">{error}</div></div>;
  if (!order) return <div className="receipt-page"><div className="receipt"><Loader2 size={18} className="kyc-spin" /> Loading…</div></div>;
  if (order.status !== 'paid') {
    return <div className="receipt-page"><div className="receipt">A receipt is available once the payment is confirmed. <Link to="/dashboard?tab=won">Back</Link></div></div>;
  }

  return (
    <div className="receipt-page">
      <div className="receipt-actions">
        <Link to={user?.role === 'admin' ? '/admin?tab=orders' : '/dashboard?tab=won'} className="salvex-btn salvex-btn-outline btn-sm"><ChevronLeft size={14} /> Back</Link>
        <button type="button" className="salvex-btn salvex-btn-primary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print / Save as PDF</button>
      </div>
      <article className="receipt">
        <div className="receipt-top">
          <div>
            <h1>Payment receipt</h1>
            <p>Salvex Auction Platform</p>
          </div>
          <div>
            <p><strong>Receipt for order {order.number}</strong></p>
            <p>Paid {when(order.paid_at)}</p>
          </div>
        </div>

        <div className="receipt-meta">
          <div><span>Order</span>{order.number}</div>
          <div><span>Payment method</span>Bank transfer</div>
          <div><span>Payment reference (UTR)</span>{order.utr}</div>
          <div><span>Auction won</span>{when(order.created_at)}</div>
        </div>

        <table>
          <thead><tr><th>Description</th><th className="amount">Amount</th></tr></thead>
          <tbody>
            <tr><td>{order.vehicle_title}<br /><small>Registration {order.registration_number}</small></td><td className="amount">{money(order.amount)}</td></tr>
            <tr className="total"><td>Total received</td><td className="amount">{money(order.amount)}</td></tr>
          </tbody>
        </table>

        <p className="receipt-note">
          This receipt confirms that Salvex received the payment above. It is not a GST tax invoice; the tax invoice is issued
          separately. Vehicles are sold as-is, where-is. Keep this receipt and your ID ready for the vehicle handover.
        </p>
      </article>
    </div>
  );
}
