import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Phone, Wrench } from 'lucide-react';
import { REQUEST_STATUS, listMyPartRequests } from '../api/parts';
import './OrdersPanel.css';

const when = (v) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The user's spare-part requests. Our team calls them; this shows where each request stands. */
export default function MyPartRequests() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setItems((await listMyPartRequests()).items); setError(null); } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error && !items) return <div className="kyc-alert kyc-alert-error"><span>{error}</span></div>;
  if (!items) return <div className="kyc-panel kyc-loading"><Loader2 size={18} className="kyc-spin" /> Loading…</div>;
  if (items.length === 0) {
    return (
      <div className="salvex-empty-state">
        <Wrench size={36} className="text-muted" />
        <h3>No part requests yet</h3>
        <Link to="/spare-parts" className="salvex-btn salvex-btn-primary btn-sm">Find or request a part</Link>
      </div>
    );
  }

  return (
    <div className="orders-list">
      {items.map((r) => {
        const s = REQUEST_STATUS[r.status] || { customerLabel: r.status, tone: 'grey' };
        return (
          <div key={r.id} className={`order-card tone-${s.tone}`}>
            <div className="order-head">
              <div>
                <span className="order-number">{r.number}</span>
                <h3>{r.part_name}</h3>
                <span className="order-sub">{r.vehicle_make} {r.vehicle_model}{r.vehicle_year ? ` (${r.vehicle_year})` : ''} · sent {when(r.created_at)}</span>
              </div>
              <span className={`order-status tone-${s.tone}`}>{s.customerLabel}</span>
            </div>
            {r.details && <p className="order-sub">{r.details}</p>}
            {r.status === 'new' && (
              <div className="order-note info">
                <Phone size={16} />
                <span>Our team will call you{r.contact_phone ? ` on ${r.contact_phone}` : ''} with the availability and price.</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
