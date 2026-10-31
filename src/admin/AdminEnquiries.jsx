import React, { useState } from 'react';
import { ExternalLink, Mail, MessageCircle, Phone, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ENQUIRY_STATUS, adminGetEnquiry, adminListEnquiries, adminUpdateEnquiry } from '../api/readyToLift';
import Select from '../components/ui/Select';
import { AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, VehicleCell, dateTime, pickFilter, useLoad } from './ui';

const FILTERS = [{ value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'closed', label: 'Closed' }, { value: '', label: 'All' }];
const digits = (phone) => (phone || '').replace(/[^0-9+]/g, '');

/** Ready to Lift "I'm interested" requests: call the buyer, then mark contacted / closed. */
export default function AdminEnquiries({ deepLink = {}, onDeepLinkClose }) {
  const [status, setStatus] = useState(pickFilter(deepLink.status, FILTERS, 'new'));
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(deepLink.id || null);
  const [notice, setNotice] = useState(null);
  const list = useLoad(() => adminListEnquiries({ status, q: search, page, page_size: 25 }), [status, search, page]);
  const closeDetail = () => { setOpenId(null); if (deepLink.id) onDeepLinkClose?.(); };

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Vehicle enquiries</h2>
          <p className="adm-muted">Buyers who tapped "I'm interested" on a Ready to Lift vehicle. Call them, then mark the enquiry Contacted or Closed.</p>
        </div>
        <form className="adm-search" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}>
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buyer, Buyer ID, phone or vehicle" aria-label="Search enquiries" />
        </form>
      </div>
      <div className="adm-tabs">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" className={status === f.value ? 'active' : ''} onClick={() => { setStatus(f.value); setPage(1); }}>{f.label}</button>
        ))}
      </div>
      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No enquiries here.</Empty> : (
        <AdmTable>
          <thead><tr><th>Vehicle</th><th>Buyer</th><th>Phone</th><th>Status</th><th>Received</th><th /></tr></thead>
          <tbody>
            {list.data.items.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => setOpenId(e.id)}>
                <td className="adm-cell-main">
                  <VehicleCell vehicleId={e.vehicle_id} photoId={e.cover_photo_id} title={e.vehicle_title}
                    sub={`${e.registration_number}${e.vehicle_sold ? ' · sold' : ''}`} />
                </td>
                <td><div className="adm-two-line"><strong>{e.buyer_name}</strong><span>{e.buyer_id} · {e.number}</span></div></td>
                <td>{e.buyer_mobile || '—'}</td>
                <td><Badge value={ENQUIRY_STATUS[e.status]?.tone} label={ENQUIRY_STATUS[e.status]?.label} /></td>
                <td>{dateTime(e.created_at)}</td>
                <td className="right"><button type="button" className="adm-btn small">Open</button></td>
              </tr>
            ))}
          </tbody>
        </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
      {openId && <EnquiryDetail id={openId} onClose={closeDetail} onSaved={(msg) => { closeDetail(); setNotice(msg); list.reload(); }} />}
    </div>
  );
}

function EnquiryDetail({ id, onClose, onSaved }) {
  const { data: e, error, loading, reload } = useLoad(() => adminGetEnquiry(id), [id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  if (!e) return <Modal title="Enquiry" onClose={onClose}>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;
  const values = form || { status: e.status, admin_note: e.admin_note || '' };

  const save = async (ev) => {
    ev.preventDefault();
    const body = {};
    if (values.status !== e.status) body.status = values.status;
    if (values.admin_note.trim() !== (e.admin_note || '')) body.admin_note = values.admin_note.trim();
    if (Object.keys(body).length === 0) { onClose(); return; }
    setBusy(true);
    setSaveError(null);
    try { await adminUpdateEnquiry(id, body); onSaved(`${e.number} updated.`); } catch (err) { setSaveError(err.message); setBusy(false); }
  };

  return (
    <Modal title={`Enquiry ${e.number}`} onClose={onClose} wide>
      <div className="adm-detail">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-card-head"><h4>Buyer</h4><Badge value={e.buyer_kyc_status} label={`KYC ${e.buyer_kyc_status}`} /></div>
            <dl className="adm-dl">
              <dt>Buyer ID</dt><dd className="mono"><strong>{e.buyer_id}</strong></dd>
              <dt>Name</dt><dd><strong>{e.buyer_name}</strong></dd>
              <dt>Mobile</dt><dd>{e.buyer_mobile || '—'}</dd>
              <dt>Email</dt><dd>{e.buyer_email}</dd>
              <dt>Received</dt><dd>{dateTime(e.created_at)}</dd>
            </dl>
            <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
              {e.buyer_mobile && <a className="adm-btn small primary" href={`tel:${digits(e.buyer_mobile)}`}><Phone size={14} /> Call</a>}
              {e.buyer_mobile && <a className="adm-btn small" href={`https://wa.me/${digits(e.buyer_mobile).replace('+', '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
              <a className="adm-btn small" href={`mailto:${e.buyer_email}?subject=${encodeURIComponent(`${e.vehicle_title} (${e.number})`)}`}><Mail size={14} /> Email</a>
            </div>
          </div>
          <div className="adm-card">
            <h4>Vehicle</h4>
            <VehicleCell vehicleId={e.vehicle_id} photoId={e.cover_photo_id} title={e.vehicle_title} sub={e.registration_number} />
            <dl className="adm-dl">
              <dt>Claim number</dt><dd className="mono">{e.claim_number}</dd>
              <dt>Location</dt><dd>{e.location}</dd>
              <dt>Listing</dt><dd>{e.vehicle_sold ? <Badge value="ended" label="Sold" /> : <Badge value="live" label="Available" />}</dd>
            </dl>
            <Link className="adm-btn small" to={`/vehicles/${e.vehicle_id}`} target="_blank"><ExternalLink size={14} /> Public page</Link>
          </div>
        </div>
        <form className="adm-form" onSubmit={save}>
          <label className="adm-field"><span>Status</span>
            <Select value={values.status} onChange={(ev) => setForm({ ...values, status: ev.target.value })}>
              {Object.entries(ENQUIRY_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </Select>
          </label>
          <label className="adm-field"><span>Note (internal)</span>
            <textarea rows={3} maxLength={1000} value={values.admin_note} placeholder="e.g. Called, visiting the yard on Monday."
              onChange={(ev) => setForm({ ...values, admin_note: ev.target.value })} />
          </label>
          <ErrorBox message={saveError} />
          <div className="adm-actions-row">
            <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn primary" disabled={busy}>Save</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
