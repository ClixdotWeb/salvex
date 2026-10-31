import React, { useState } from 'react';
import { ImagePlus, Mail, MessageCircle, Phone, Plus, Search } from 'lucide-react';
import {
  REQUEST_STATUS, adminCreatePart, adminGetPartRequest, adminListPartRequests, adminListParts, adminPartPhoto, adminUpdatePart,
  adminUpdatePartRequest, partPhotoUrl,
} from '../api/parts';
import { photoProblem } from '../api/vehicles';
import { AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, dateTime, money, pickFilter, useLoad } from './ui';
import Select from '../components/ui/Select';

const digits = (phone) => (phone || '').replace(/[^0-9+]/g, '');

/** Spare part enquiries: people ask for a part; the admin checks, sends a price, and the user is notified. */
export function PartEnquiries({ deepLink, onDeepLinkClose }) {
  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Spare part enquiries</h2>
          <p className="adm-muted">People asking for a part. Call them, then mark the enquiry Contacted or Closed. Nothing is sent to the customer from here.</p>
        </div>
      </div>
      <Requests deepLink={deepLink} onDeepLinkClose={onDeepLinkClose} />
    </div>
  );
}

/** The fixed-price parts shown on the Spare parts page. */
export function PartsCatalogue() {
  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Spare parts catalogue</h2>
          <p className="adm-muted">Parts with a fixed price shown on the website. Add a part with a photo, price and stock.</p>
        </div>
      </div>
      <Catalogue />
    </div>
  );
}

const REQUEST_FILTERS = ['new', 'contacted', 'closed', ''].map((value) => ({ value }));

function Requests({ deepLink = {}, onDeepLinkClose }) {
  const [status, setStatus] = useState(pickFilter(deepLink.status, REQUEST_FILTERS, 'new'));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const linked = useLoad(() => (deepLink.id ? adminGetPartRequest(deepLink.id) : Promise.resolve(null)), [deepLink.id]);
  const [linkDone, setLinkDone] = useState(false);
  const shown = open || (!linkDone && linked.data);
  const closeDetail = () => { setOpen(null); setLinkDone(true); if (deepLink.id) onDeepLinkClose?.(); };
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad(() => adminListPartRequests({ status, q: search, page, page_size: 25 }), [status, search, page]);

  return (
    <>
      <div className="adm-toolbar">
        <div className="adm-tabs">
          {[['new', 'New'], ['contacted', 'Contacted'], ['closed', 'Closed'], ['', 'All']].map(([v, l]) => (
            <button key={l} type="button" className={status === v ? 'active' : ''} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <form className="adm-search" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}>
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Customer, Buyer ID, phone or part" aria-label="Search spare part enquiries" />
        </form>
      </div>
      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No enquiries here.</Empty> : (
        <AdmTable>
            <thead><tr><th>Part</th><th>Vehicle</th><th>Customer</th><th>Phone</th><th>Status</th><th>Received</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                  <td><div className="adm-two-line"><strong>{r.part_name}</strong><span>{r.number}{r.part_id ? ' · from catalogue' : ''}</span></div></td>
                  <td>{r.vehicle_make} {r.vehicle_model}{r.vehicle_year ? ` (${r.vehicle_year})` : ''}</td>
                  <td><div className="adm-two-line"><strong>{r.user_name}</strong><span>{r.buyer_id}</span></div></td>
                  <td>{r.contact_phone || r.user_mobile || '—'}</td>
                  <td><Badge value={REQUEST_STATUS[r.status]?.badge} label={REQUEST_STATUS[r.status]?.label || r.status} /></td>
                  <td>{dateTime(r.created_at)}</td>
                  <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
      {shown && <RequestDetail request={shown} onClose={closeDetail} onSaved={(msg) => { closeDetail(); setNotice(msg); list.reload(); }} />}
    </>
  );
}

function RequestDetail({ request: r, onClose, onSaved }) {
  const [form, setForm] = useState({ status: r.status, admin_note: r.admin_note || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const phone = r.contact_phone || r.user_mobile;

  const save = async (e) => {
    e.preventDefault();
    const body = {};
    if (form.status !== r.status) body.status = form.status;
    if (form.admin_note.trim() !== (r.admin_note || '')) body.admin_note = form.admin_note.trim();
    if (Object.keys(body).length === 0) { onClose(); return; }
    setBusy(true);
    setError(null);
    try { await adminUpdatePartRequest(r.id, body); onSaved(`${r.number} updated.`); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={`Spare part enquiry ${r.number}`} onClose={onClose}>
      <div className="adm-detail">
        <dl className="adm-dl">
          <dt>Part</dt><dd><strong>{r.part_name}</strong>{r.part_id ? ' (from catalogue)' : ''}</dd>
          <dt>Vehicle</dt><dd>{r.vehicle_make} {r.vehicle_model}{r.vehicle_year ? ` (${r.vehicle_year})` : ''}</dd>
          <dt>Details</dt><dd>{r.details || '—'}</dd>
          <dt>Customer</dt><dd><strong>{r.user_name}</strong>{r.buyer_id ? ` · ${r.buyer_id}` : ''}</dd>
          <dt>Phone</dt><dd>{phone || '—'}</dd>
          <dt>Email</dt><dd>{r.user_email}</dd>
          <dt>Received</dt><dd>{dateTime(r.created_at)}</dd>
        </dl>
        <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
          {phone && <a className="adm-btn small primary" href={`tel:${digits(phone)}`}><Phone size={14} /> Call</a>}
          {phone && <a className="adm-btn small" href={`https://wa.me/${digits(phone).replace('+', '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
          <a className="adm-btn small" href={`mailto:${r.user_email}?subject=${encodeURIComponent(`${r.part_name} (${r.number})`)}`}><Mail size={14} /> Email</a>
        </div>
        <form className="adm-form" onSubmit={save}>
          <label className="adm-field"><span>Status</span>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(REQUEST_STATUS).map(([v, st]) => <option key={v} value={v}>{st.label}</option>)}
            </Select>
          </label>
          <label className="adm-field"><span>Note (internal, the customer does not see it)</span>
            <textarea rows={3} maxLength={1000} value={form.admin_note} onChange={(e) => setForm({ ...form, admin_note: e.target.value })}
              placeholder="e.g. Told Rs 2,800, collects from the Kochi yard on Monday." />
          </label>
          <ErrorBox message={error} />
          <div className="adm-actions-row">
            <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn primary" disabled={busy}>Save</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

const EMPTY_PART = { name: '', make: '', model: '', year_from: '', year_to: '', condition: 'used', price: '', stock: 1, description: '', is_active: true };

function Catalogue() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const list = useLoad(() => adminListParts({ q: search, page, page_size: 25 }), [search, page]);

  return (
    <>
      <div className="adm-toolbar">
        <form className="adm-search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part, make or model" />
        </form>
        <button type="button" className="adm-btn primary" onClick={() => setEditing(EMPTY_PART)}><Plus size={15} /> Add part</button>
      </div>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No parts yet. Add the important ones you have in stock.</Empty> : (
        <AdmTable>
            <thead><tr><th>Part</th><th>Fits</th><th>Condition</th><th>Price</th><th>Stock</th><th>Shown</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                  <td><strong>{p.name}</strong>{!p.has_photo && <div className="adm-muted small">no photo</div>}</td>
                  <td>{p.make} {p.model || '(all models)'}{p.year_from || p.year_to ? ` · ${p.year_from || '…'}–${p.year_to || '…'}` : ''}</td>
                  <td>{p.condition}</td>
                  <td>{money(p.price)}</td>
                  <td>{p.stock}</td>
                  <td><Badge value={p.is_active ? 'active' : 'draft'} label={p.is_active ? 'yes' : 'hidden'} /></td>
                  <td className="right"><button type="button" className="adm-btn small">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
      {editing && <PartEditor part={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function PartEditor({ part, onClose, onSaved }) {
  const isNew = !part.id;
  const [form, setForm] = useState({ ...EMPTY_PART, ...part, model: part.model || '', year_from: part.year_from || '', year_to: part.year_to || '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (photo && photoProblem(photo)) { setError(photoProblem(photo)); return; }
    const body = {
      name: form.name, make: form.make, model: form.model || null, condition: form.condition, price: String(form.price),
      stock: Number(form.stock), description: form.description, is_active: Boolean(form.is_active),
      year_from: form.year_from ? Number(form.year_from) : null, year_to: form.year_to ? Number(form.year_to) : null,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = isNew ? await adminCreatePart(body) : await adminUpdatePart(part.id, body);
      if (photo) await adminPartPhoto(saved.id, photo);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add spare part' : `Edit ${part.name}`} onClose={onClose}>
      <form className="adm-form" onSubmit={save}>
        <label className="adm-field"><span>Part name *</span><input required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
        <div className="adm-grid-2">
          <label className="adm-field"><span>Make *</span><input required maxLength={60} value={form.make} onChange={(e) => set('make', e.target.value)} /></label>
          <label className="adm-field"><span>Model (empty = all models)</span><input maxLength={60} value={form.model} onChange={(e) => set('model', e.target.value)} /></label>
          <label className="adm-field"><span>Year from</span><input type="number" min="1950" max="2100" value={form.year_from} onChange={(e) => set('year_from', e.target.value)} /></label>
          <label className="adm-field"><span>Year to</span><input type="number" min="1950" max="2100" value={form.year_to} onChange={(e) => set('year_to', e.target.value)} /></label>
          <label className="adm-field"><span>Condition</span>
            <Select value={form.condition} onChange={(e) => set('condition', e.target.value)}><option value="used">Used</option><option value="new">New</option></Select></label>
          <label className="adm-field"><span>Price (₹) *</span><input required type="number" min="1" step="1" value={form.price} onChange={(e) => set('price', e.target.value)} /></label>
          <label className="adm-field"><span>Stock *</span><input required type="number" min="0" value={form.stock} onChange={(e) => set('stock', e.target.value)} /></label>
          <label className="adm-check"><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /><span>Show on the website</span></label>
        </div>
        <label className="adm-field"><span>Description</span><textarea rows={3} maxLength={1000} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
        <div className="adm-inline">
          {part.has_photo && <img src={partPhotoUrl(part.id)} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }} />}
          <label className="adm-btn small"><ImagePlus size={14} /> {photo ? photo.name : part.has_photo ? 'Replace photo' : 'Add photo'}
            <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
        </div>
        <ErrorBox message={error} />
        <div className="adm-actions-row">
          <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="adm-btn primary" disabled={busy}>{isNew ? 'Add part' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
