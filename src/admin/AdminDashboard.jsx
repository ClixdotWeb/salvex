import React, { useEffect } from 'react';
import {
  AlertTriangle, ArrowRight, Car, Clock, FileSpreadsheet, Gavel, Hand, Hourglass, Inbox, Landmark, PauseCircle, Plus, ShieldCheck,
  Truck, Users, Wrench,
} from 'lucide-react';
import { getDashboard } from '../api/admin';
import { useAuth } from '../auth/useAuth';
import { ErrorBox, Spinner, dateTime, useLoad } from './ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function AdminDashboard({ go }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(getDashboard, []);

  useEffect(() => {
    const timer = setInterval(reload, 15000);           // keep the counters current while the page is open
    return () => clearInterval(timer);
  }, [reload]);

  if (!data && loading) return <Spinner />;
  if (!data) return <ErrorBox message={error} onRetry={reload} />;

  // things waiting for the admin (pastel cards)
  const attention = [
    { label: 'New vehicle enquiries', status: 'new', value: data.enquiries_new, icon: Hand, tone: 'lavender', to: 'enquiries' },
    { label: 'KYC waiting for review', status: 'submitted', value: data.kyc_waiting_review, icon: ShieldCheck, tone: 'amber', to: 'kyc' },
    { label: 'New spare part enquiries', status: 'new', value: data.part_requests_new, icon: Wrench, tone: 'rose', to: 'part-enquiries' },
    ...(data.online_payment
      ? [{ label: 'Payments to verify', status: 'payment_submitted', value: data.payments_to_confirm, icon: Landmark, tone: 'green', to: 'orders' }]
      : [{ label: 'Deals with fee pending', status: 'sold', value: data.deals_fee_pending, icon: Landmark, tone: 'green', to: 'results' }]),
    { label: 'Vehicles waiting for review', status: 'waiting', value: data.vehicles_waiting_review, icon: Car, tone: 'sky', to: 'auctions' },
    { label: 'New contact messages', status: 'new', value: data.contact_messages_new, icon: Inbox, tone: 'slate', to: 'messages' },
  ];
  const waitingTotal = attention.reduce((sum, t) => sum + (Number(t.value) || 0), 0);

  // the rest of the figures (white cards)
  const figures = [
    ...(data.online_payment ? [{ label: 'Awaiting payment', status: 'awaiting_payment', value: data.orders_awaiting_payment, icon: Hourglass, to: 'orders' }] : []),
    { label: 'Ready to Lift available', value: data.ready_to_lift_available, icon: Truck, to: 'ready-to-lift' },
    { label: 'Upcoming auctions', status: 'upcoming', value: data.auctions_upcoming, icon: Clock, to: 'auctions' },
    { label: 'Paused auctions', status: 'live', value: data.auctions_paused, icon: PauseCircle, to: 'auctions' },
    { label: 'Approved vehicles', status: 'waiting', value: data.vehicles_approved, icon: Car, to: 'auctions' },
    { label: 'Users', value: data.users_total, icon: Users, to: 'users',
      sub: `${data.bidders} bidders · ${data.sellers} sellers${data.suspended_users ? ` · ${data.suspended_users} suspended` : ''}` },
  ];

  return (
    <div className="adm-section adm-dash">
      {data.auctions_awaiting_close > 0 && (
        <div className="adm-alert adm-alert-warning">
          <AlertTriangle size={16} />
          <span>{data.auctions_awaiting_close} auction(s) have passed their end time and are being closed automatically.</span>
        </div>
      )}

      <div className="adm-dash-hero">
        <section className="adm-dash-welcome">
          <span className="adm-dash-eyebrow">Dashboard</span>
          <h2>{greeting()}, {(user?.name || '').split(' ')[0]}</h2>
          <p>{waitingTotal > 0 ? <><strong>{waitingTotal}</strong> {waitingTotal === 1 ? 'thing needs' : 'things need'} your attention.</> : 'Nothing is waiting for you right now.'}
            <span className="adm-dash-time"> Updated {dateTime(data.server_time)}</span></p>
          <div className="adm-dash-actions">
            <button type="button" className="adm-btn primary" onClick={() => go('auctions', 'new')}><Plus size={15} /> New auction</button>
            <button type="button" className="adm-btn" onClick={() => go('auctions', 'upload')}><FileSpreadsheet size={15} /> Bulk upload</button>
            <button type="button" className="adm-btn" onClick={() => go('ready-to-lift', 'add')}><Truck size={15} /> Add Ready to Lift</button>
          </div>
        </section>

        <button type="button" className="adm-dash-live" onClick={() => go('auctions', 'live')}>
          <span className="adm-dash-live-pill"><span className="dot" /> Live now</span>
          <span className="adm-dash-live-row">
            <span><strong>{data.auctions_live}</strong><small>live auctions</small></span>
            <span><strong>{data.bids_today}</strong><small>bids today</small></span>
          </span>
          <span className="adm-dash-live-go">Open auctions <ArrowRight size={15} /></span>
          <span className="adm-dash-live-art" aria-hidden="true"><Gavel size={120} /></span>
        </button>
      </div>

      <div className="adm-dash-head"><h3>Needs your attention</h3></div>
      <div className="adm-dash-attention">
        {attention.map((t) => (
          <button key={t.label} type="button" className={`adm-pastel tone-${t.tone}${t.value > 0 ? ' has' : ''}`} onClick={() => go(t.to, t.status)}>
            <span className="adm-pastel-top"><span className="adm-pastel-icon"><t.icon size={18} /></span><ArrowRight size={15} className="adm-pastel-go" /></span>
            <span className="adm-pastel-value">{t.value}</span>
            <span className="adm-pastel-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="adm-dash-head"><h3>At a glance</h3></div>
      <div className="adm-dash-figures">
        {figures.map((t) => (
          <button key={t.label} type="button" className="adm-figure" onClick={() => go(t.to, t.status)}>
            <span className="adm-figure-icon"><t.icon size={18} /></span>
            <span className="adm-figure-text">
              <strong>{t.value}</strong>
              <span>{t.label}</span>
              {t.sub && <small>{t.sub}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
