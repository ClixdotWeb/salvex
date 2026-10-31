import React, { useState } from 'react';
import { Car, ChevronLeft, ChevronRight, Download, IndianRupee, Receipt, Users, Wallet } from 'lucide-react';
import { getMonthlyReport, reportExportUrl } from '../api/admin';
import { AdmTable, Badge, Empty, ErrorBox, Spinner, dateTime, money, useLoad } from './ui';

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };
const thisMonth = () => monthKey(new Date());
const lastMonth = () => shiftMonth(thisMonth(), -1);
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
const shortDate = (value) => (value ? new Date(value.length === 10 ? `${value}T12:00:00` : value)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const TABS = [
  { id: 'payments', label: 'Payments & fees' },
  { id: 'vehicles', label: 'Vehicles uploaded' },
  { id: 'buyers', label: 'Buyers registered' },
];

/** Monthly report for the client: deals with service fee received / pending, vehicles added, buyers registered. */
export default function AdminReports({ deepLink = {}, go }) {
  // the running month by default (the reminder on the 1st links to the month that just ended)
  const initial = /^\d{4}-\d{2}$/.test(deepLink.month || '') ? deepLink.month : thisMonth();
  const [month, setMonth] = useState(initial);
  const [tab, setTab] = useState('payments');
  const report = useLoad(() => getMonthlyReport(month), [month]);
  const data = report.data;

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Reports</h2>
          <p className="adm-muted">Monthly figures from the database. Fee amounts are the ones recorded on each result.</p>
        </div>
        <div className="adm-report-month">
          <div className="adm-month-switch" role="group" aria-label="Month">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
            <strong aria-live="polite">{monthLabel(month)}</strong>
            <button type="button" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
          </div>
          <div className="adm-month-quick">
            <button type="button" className={month === thisMonth() ? 'active' : ''} onClick={() => setMonth(thisMonth())}>This month</button>
            <button type="button" className={month === lastMonth() ? 'active' : ''} onClick={() => setMonth(lastMonth())}>Last month</button>
          </div>
        </div>
      </div>

      <ErrorBox message={report.error} onRetry={report.reload} />
      {!data && report.loading && <Spinner />}
      {data && (
        <>
          <h3 className="adm-report-title">{data.label}</h3>
          <div className="adm-tiles adm-report-tiles">
            <Tile icon={Car} tone="blue" label="Vehicles uploaded" value={data.totals.vehicles_uploaded} />
            <Tile icon={Users} tone="navy" label="Buyers registered" value={data.totals.buyers_registered} />
            <Tile icon={Receipt} tone="blue" label="Deals" value={data.totals.deals} sub={`Approved ${money(data.totals.approved_amount)}`} />
            <Tile icon={IndianRupee} tone="navy" label="Service fee (total)" value={money(data.totals.service_fee)} />
            <Tile icon={Wallet} tone="green" label="Fee received" value={money(data.totals.fee_received)} />
            <Tile icon={Wallet} tone={Number(data.totals.fee_pending) > 0 ? 'amber' : 'green'} label="Fee pending" value={money(data.totals.fee_pending)} />
          </div>

          <div className="adm-report-bar">
            <div className="adm-tabs">
              {TABS.map((t) => (
                <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  {t.label} <span className="adm-tab-count">{data[t.id].length}</span>
                </button>
              ))}
            </div>
            <a className="adm-btn primary" href={reportExportUrl(month, tab)} download>
              <Download size={15} /> Download Excel
            </a>
          </div>

          {tab === 'payments' && (data.payments.length === 0 ? <Empty>No deals approved in {data.label}.</Empty> : (
            <AdmTable>
              <thead><tr><th>Claim no.</th><th>Vehicle</th><th>Approved amount</th><th>Approved date</th><th>Buyer</th>
                <th>Fee received</th><th>Pending fee</th><th>Received date</th><th>Reference no.</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.order_id} className="clickable" onClick={() => go && go('results', 'sold', p.auction_id)}>
                    <td className="mono">{p.claim_number}</td>
                    <td className="adm-cell-main"><div className="adm-two-line"><strong>{p.vehicle}</strong><span>{p.registration_number}</span></div></td>
                    <td><strong>{money(p.approved_amount)}</strong></td>
                    <td>{shortDate(p.approved_at)}</td>
                    <td><div className="adm-two-line"><strong>{p.buyer_name}</strong><span>{p.buyer_id}{p.buyer_mobile ? ` · ${p.buyer_mobile}` : ''}</span></div></td>
                    <td>{money(p.fee_received)}</td>
                    <td>{p.fee_pending === null ? <span className="adm-muted">fee not set</span>
                      : Number(p.fee_pending) > 0 ? <Badge value="pending" label={money(p.fee_pending)} /> : <Badge value="approved" label="Paid" />}</td>
                    <td>{shortDate(p.fee_received_on)}</td>
                    <td className="wrap small">{p.references || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </AdmTable>
          ))}

          {tab === 'vehicles' && (data.vehicles.length === 0 ? <Empty>No vehicles added in {data.label}.</Empty> : (
            <AdmTable>
              <thead><tr><th>Added on</th><th>Claim no.</th><th>Vehicle</th><th>Category</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>
                {data.vehicles.map((v) => (
                  <tr key={v.vehicle_id}>
                    <td>{dateTime(v.added_at)}</td>
                    <td className="mono">{v.claim_number}</td>
                    <td className="adm-cell-main"><div className="adm-two-line"><strong>{v.vehicle}</strong><span>{v.registration_number}</span></div></td>
                    <td>{v.category}</td>
                    <td>{v.location}</td>
                    <td><Badge value={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </AdmTable>
          ))}

          {tab === 'buyers' && (data.buyers.length === 0 ? <Empty>No buyers registered in {data.label}.</Empty> : (
            <AdmTable>
              <thead><tr><th>Buyer ID</th><th>Name</th><th>Mobile</th><th>KYC</th><th>Account</th><th>Registered</th></tr></thead>
              <tbody>
                {data.buyers.map((b) => (
                  <tr key={b.user_id}>
                    <td className="mono"><strong>{b.buyer_id}</strong></td>
                    <td><div className="adm-two-line"><strong>{b.name}</strong><span>{b.email}</span></div></td>
                    <td>{b.mobile || '—'}</td>
                    <td><Badge value={b.kyc_status} /></td>
                    <td><Badge value={b.is_active ? 'active' : 'suspended'} /></td>
                    <td>{dateTime(b.registered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </AdmTable>
          ))}
        </>
      )}
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className={`adm-tile tone-${tone} static`}>
      <span className="adm-tile-icon"><Icon size={20} /></span>
      <span className="adm-tile-value">{value}</span>
      <span className="adm-tile-label">{label}</span>
      {sub && <span className="adm-tile-sub">{sub}</span>}
    </div>
  );
}
