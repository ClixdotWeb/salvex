import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Loader2, PackageSearch, Phone, Search, Send, Wrench } from 'lucide-react';
import { createPartRequest, listParts, partPhotoUrl } from '../api/parts';
import { useAuth } from '../auth/useAuth';
import { money } from './shared';
import ModalLayer from './ModalLayer';
import './public.css';

const fits = (p) => `${p.make}${p.model ? ` ${p.model}` : ' (all models)'}${p.year_from || p.year_to ? `, ${p.year_from || '…'}–${p.year_to || '…'}` : ''}`;

/** Fixed-price spare parts and "request a part" (any part for any vehicle). */
export default function SparePartsPage() {
  const [filters, setFilters] = useState({ make: '', model: '', year: '', q: '' });
  const [applied, setApplied] = useState(filters);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [requesting, setRequesting] = useState(null);       // null | {} (free request) | part
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setData(null);
    try { setData(await listParts({ ...applied, page_size: 24 })); setError(null); } catch (err) { setError(err.message); }
  }, [applied]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="pub-page parts-page">
      <div className="pub-container">
        <div className="pub-head">
          <div>
            <h1>Spare parts</h1>
            <p>Quality-checked parts at fixed prices. Can't find yours? Tell us the vehicle and the part, and we will find it for you.</p>
          </div>
          <button type="button" className="pub-btn primary" onClick={() => setRequesting({})}><Send size={16} /> Request a part</button>
        </div>

        <form className="pub-filters" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
          <input className="pub-year wide" placeholder="Make (e.g. Maruti)" value={filters.make} onChange={(e) => set('make', e.target.value)} aria-label="Make" />
          <input className="pub-year wide" placeholder="Model (e.g. Swift)" value={filters.model} onChange={(e) => set('model', e.target.value)} aria-label="Model" />
          <input className="pub-year" type="number" placeholder="Year" min="1950" max="2100" value={filters.year} onChange={(e) => set('year', e.target.value)} aria-label="Year" />
          <div className="pub-search"><Search size={16} /><input placeholder="Part (e.g. bumper, headlamp)" value={filters.q} onChange={(e) => set('q', e.target.value)} aria-label="Part" /></div>
          <button type="submit" className="pub-btn primary">Search</button>
        </form>

        {error && <div className="pub-error">Could not load parts. <button type="button" onClick={load}>Try again</button></div>}
        {!data && !error && <div className="pub-loading"><Loader2 size={18} className="pub-spin" /> Loading parts…</div>}
        {data && data.items.length === 0 && (
          <div className="pub-empty">
            <PackageSearch size={34} />
            <h3>No listed part matches</h3>
            <p>We can still find it for you.</p>
            <button type="button" className="pub-btn primary" onClick={() => setRequesting({ make: applied.make, model: applied.model, year: applied.year, part: applied.q })}>
              <Send size={16} /> Request this part
            </button>
          </div>
        )}
        {data && data.items.length > 0 && (
          <div className="pub-grid">
            {data.items.map((p) => (
              <div key={p.id} className="pub-card">
                <div className="pub-card-media">
                  {p.has_photo ? <img src={partPhotoUrl(p.id)} alt={p.name} loading="lazy" /> : <div className="pub-photo-empty"><Wrench size={34} /></div>}
                  <span className="pub-phase phase-upcoming">{p.condition === 'new' ? 'New' : 'Used'}</span>
                </div>
                <div className="pub-card-body">
                  <h3>{p.name}</h3>
                  <p className="pub-card-sub">Fits {fits(p)}</p>
                  {p.description && <p className="pub-card-meta">{p.description}</p>}
                  <div className="pub-card-price">
                    <div><span>Price</span><strong>{money(p.price)}</strong></div>
                    <div className="right"><span>{p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</span></div>
                  </div>
                  <button type="button" className="pub-btn block" onClick={() => setRequesting({ part: p })}>
                    {p.stock > 0 ? 'Request this part' : 'Ask when available'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {requesting && <RequestPart prefill={requesting} onClose={() => setRequesting(null)} />}
    </div>
  );
}

function RequestPart({ prefill, onClose }) {
  const { user } = useAuth();
  const location = useLocation();
  const listed = prefill.part;
  const [form, setForm] = useState({
    vehicle_make: listed?.make || prefill.make || '', vehicle_model: listed?.model || prefill.model || '',
    vehicle_year: prefill.year || '', part_name: listed?.name || prefill.part || '', details: '',
    contact_phone: user?.mobile || '',
  });
  // The account already has a mobile number (required at registration): no need to ask again.
  const knownPhone = (user?.mobile || '').trim();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createPartRequest({
        ...form, vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null, part_id: listed?.id || null,
      });
      setDone(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalLayer onClose={onClose} locked={busy}>
      <div className="pub-modal" role="dialog" aria-modal="true" aria-label="Request a part">
        {!user ? (
          <>
            <h3>Request a part</h3>
            <p>Please sign in to send a request. Our team will call you.</p>
            <div className="pub-modal-actions">
              <button type="button" className="pub-btn" onClick={onClose}>Close</button>
              <Link to="/login" state={{ from: location }} className="pub-btn primary">Sign in</Link>
            </div>
          </>
        ) : done ? (
          <>
            <h3><CheckCircle2 size={20} className="text-success" /> Request sent</h3>
            <p>Your request number is <strong>{done.number}</strong>. Our team will call you on <strong>{done.contact_phone}</strong> with the availability and price.</p>
            <div className="pub-modal-actions">
              <button type="button" className="pub-btn" onClick={onClose}>Close</button>
              <Link to="/dashboard?tab=parts" className="pub-btn primary">My requests</Link>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="pub-request-form">
            <h3>{listed ? `Request: ${listed.name}` : 'Request a part'}</h3>
            {listed && <p className="pub-muted">Listed at {money(listed.price)}. Our team will call you to confirm availability and the final price.</p>}
            <div className="pub-form-grid">
              <label><span>Vehicle make *</span><input required maxLength={60} value={form.vehicle_make} onChange={(e) => set('vehicle_make', e.target.value)} /></label>
              <label><span>Model *</span><input required maxLength={60} value={form.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} /></label>
              <label><span>Year</span><input type="number" min="1950" max="2100" value={form.vehicle_year} onChange={(e) => set('vehicle_year', e.target.value)} /></label>
              <label><span>Part needed *</span><input required maxLength={120} value={form.part_name} onChange={(e) => set('part_name', e.target.value)} /></label>
              {!knownPhone && (
                <label><span>Your phone number * (we will call you)</span><input required type="tel" inputMode="tel" maxLength={20}
                  autoComplete="tel" placeholder="+91 98470 12345" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} /></label>
              )}
            </div>
            {knownPhone && (
              <p className="pub-call-note"><Phone size={15} /> <span>We will call you on <strong>{knownPhone}</strong>.
                {' '}<Link to="/dashboard?tab=profile" onClick={onClose}>Change number</Link></span></p>
            )}
            <label className="full"><span>Details (variant, side, part number…)</span>
              <textarea rows={3} maxLength={1000} value={form.details} onChange={(e) => set('details', e.target.value)} /></label>
            {error && <p className="pub-form-error" role="alert">{error}</p>}
            <div className="pub-modal-actions">
              <button type="button" className="pub-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="pub-btn primary" disabled={busy}>{busy ? <Loader2 size={15} className="pub-spin" /> : <Send size={15} />} Send request</button>
            </div>
          </form>
        )}
      </div>
    </ModalLayer>
  );
}
