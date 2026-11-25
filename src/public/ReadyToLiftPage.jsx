import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gauge, Info, Loader2, MapPin, Search, Truck } from 'lucide-react';
import { READY_TO_LIFT_NOTE, listReadyToLift } from '../api/readyToLift';
import { VehiclePhoto } from './shared';
import InterestButton from './InterestButton';
import './public.css';

const FUEL = { petrol: 'Petrol', diesel: 'Diesel', cng: 'CNG', lpg: 'LPG', electric: 'Electric', hybrid: 'Hybrid', petrol_cng: 'Petrol + CNG' };
const km = (value) => (value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-IN')} km`);

/** One Ready to Lift vehicle card (no price; "I'm interested" instead of a bid). */
export function ReadyToLiftCard({ vehicle: v }) {
  return (
    <div className="pub-card pub-rtl-card">
      <Link to={`/vehicles/${v.id}`} className="pub-card-media">
        <VehiclePhoto vehicle={v} size="thumb" />
        <span className="pub-rtl-badge"><Truck size={12} /> Ready to Lift</span>
      </Link>
      <div className="pub-card-body">
        <Link to={`/vehicles/${v.id}`} className="pub-card-title-link"><h3>{v.manufacturing_year} {v.make} {v.model}</h3></Link>
        <p className="pub-card-sub">{v.variant} · {v.registration_number}</p>
        <p className="pub-card-meta"><MapPin size={13} /> {v.location}</p>
        <div className="pub-rtl-facts">
          <span><Gauge size={13} /> {km(v.km_driven)}</span>
          <span>{FUEL[v.fuel_type] || v.fuel_type}</span>
          <span className={v.superdari ? 'warn' : ''}>Superdari: {v.superdari ? 'Yes' : 'No'}</span>
        </div>
        <div className="pub-rtl-actions">
          <Link to={`/vehicles/${v.id}`} className="pub-btn">Details</Link>
          <InterestButton vehicleId={v.id} title={`${v.manufacturing_year} ${v.make} ${v.model} ${v.variant || ''}`.trim()} />
        </div>
      </div>
    </div>
  );
}

/** Public list of vehicles ready for immediate collection. */
export default function ReadyToLiftPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (pageNumber, append) => {
    setLoading(true);
    try {
      const data = await listReadyToLift({ q: search, page: pageNumber, page_size: 12 });
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setPage(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);
  useEffect(() => { load(1, false); }, [load]);

  return (
    <div className="pub-page">
      <div className="pub-container">
        <div className="pub-head">
          <div>
            <h1>Ready to Lift Vehicles</h1>
            <p>Available now: no auction and no waiting. Tap <strong>I'm interested</strong> and our team will call you.</p>
          </div>
        </div>
        <div className="pub-rtl-note"><Info size={18} /> <p>{READY_TO_LIFT_NOTE}</p></div>

        <form className="pub-filters" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <div className="pub-search"><Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Make, model or location" aria-label="Search Ready to Lift vehicles" /></div>
          <button type="submit" className="pub-btn primary">Search</button>
        </form>

        {error && items.length === 0 && <div className="pub-error">Could not load vehicles. <button type="button" onClick={() => load(1, false)}>Try again</button></div>}
        {loading && items.length === 0 && !error && <div className="pub-loading"><Loader2 size={18} className="pub-spin" /> Loading…</div>}
        {!loading && !error && items.length === 0 && (
          <div className="pub-empty">
            <Truck size={34} />
            <h3>{search ? 'No vehicle matches your search' : 'No Ready to Lift vehicles right now'}</h3>
            <p>New vehicles are added regularly. You can also browse the live auctions.</p>
            <Link to="/auctions/live" className="pub-btn primary">Browse live auctions <ArrowRight size={15} /></Link>
          </div>
        )}
        {items.length > 0 && <div className="pub-grid">{items.map((v) => <ReadyToLiftCard key={v.id} vehicle={v} />)}</div>}
        {page && page.page < page.pages && (
          <div className="pub-more">
            <button type="button" className="pub-btn" disabled={loading} onClick={() => load(page.page + 1, true)}>{loading ? 'Loading…' : 'Show more'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Home page highlight: the newest Ready to Lift vehicles (hidden when there are none). */
export function HomeReadyToLift() {
  const [items, setItems] = useState(null);
  useEffect(() => { listReadyToLift({ page_size: 6 }).then((d) => setItems(d.items)).catch(() => setItems([])); }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="pub-home-section pub-home-rtl">
      <div className="pub-container">
        <div className="pub-head">
          <div>
            <span className="pub-rtl-eyebrow"><Truck size={14} /> Available now</span>
            <h2>Ready to Lift</h2>
            <p>No auction, no waiting: vehicles ready for immediate collection.</p>
          </div>
          <Link to="/ready-to-lift" className="pub-link">View all <ArrowRight size={15} /></Link>
        </div>
        <div className="pub-grid">{items.map((v) => <ReadyToLiftCard key={v.id} vehicle={v} />)}</div>
      </div>
    </section>
  );
}
