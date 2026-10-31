import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Gavel, Loader2, PackageSearch, Search, Truck, Wrench, X } from 'lucide-react';
import { listCatalogue } from '../api/vehicles';
import { listReadyToLift } from '../api/readyToLift';
import { listParts, partPhotoUrl } from '../api/parts';
import { AuctionCard, money } from './shared';
import { ReadyToLiftCard } from './ReadyToLiftPage';
import './public.css';

const clean = (text) => text.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);

/** One search box for the whole site: auctions (live and upcoming), Ready to Lift vehicles and spare parts. */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = clean(params.get('q') || '');
  const [text, setText] = useState(q);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(false);
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);

  // typing updates the address (?q=...) after a short pause; the address drives the search
  useEffect(() => {
    const next = clean(text);
    if (next === q) return undefined;
    const timer = setTimeout(() => setParams(next ? { q: next } : {}, { replace: true }), 350);
    return () => clearTimeout(timer);
  }, [text, q, setParams]);

  useEffect(() => {
    if (!q) { setResults(null); return undefined; }
    let alive = true;
    setResults(null);
    setError(false);
    Promise.all([
      listCatalogue({ q, listing_type: 'auction', page_size: 24 }),
      listReadyToLift({ q, page_size: 12 }),
      listParts({ q, page_size: 12 }),
    ]).then(([vehicles, rtl, parts]) => {
      if (!alive) return;
      // only vehicles with an auction that is open (live or upcoming) can be bid on
      const auctions = vehicles.items.filter((v) => v.auction && ['live', 'upcoming', 'paused'].includes(v.auction.phase))
        .map((v) => ({ ...v.auction, vehicle: v }));
      setResults({ auctions, rtl: rtl.items, parts: parts.items });
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [q]);

  const total = results ? results.auctions.length + results.rtl.length + results.parts.length : 0;

  return (
    <div className="pub-page">
      <div className="pub-container">
        <div className="pub-head">
          <div>
            <h1>Search</h1>
            <p>Find auctions, Ready to Lift vehicles and spare parts by make, model or part name.</p>
          </div>
        </div>

        <form className="pub-site-search" role="search" onSubmit={(e) => { e.preventDefault(); setParams(clean(text) ? { q: clean(text) } : {}, { replace: true }); }}>
          <Search size={20} aria-hidden="true" />
          <input ref={input} type="search" value={text} onChange={(e) => setText(e.target.value)} maxLength={80}
            placeholder="e.g. Swift, Hyundai i20, bumper" aria-label="Search the site" enterKeyHint="search" />
          {text && <button type="button" className="pub-site-search-clear" onClick={() => { setText(''); setParams({}, { replace: true }); input.current?.focus(); }} aria-label="Clear search"><X size={18} /></button>}
        </form>

        {!q && (
          <div className="pub-search-hints">
            <span>Popular:</span>
            {['Swift', 'Innova', 'i20', 'Activa', 'Bumper', 'Headlamp'].map((s) => (
              <button key={s} type="button" onClick={() => setText(s)}>{s}</button>
            ))}
          </div>
        )}

        {q && error && <div className="pub-error">Could not search right now. Please try again.</div>}
        {q && !error && !results && <div className="pub-loading"><Loader2 size={18} className="pub-spin" /> Searching…</div>}

        {results && total === 0 && (
          <div className="pub-empty">
            <PackageSearch size={34} />
            <h3>Nothing found for “{q}”</h3>
            <p>Try another make or model, or ask us for a spare part and we will find it for you.</p>
            <Link to="/spare-parts" className="pub-btn primary">Request a part <ArrowRight size={15} /></Link>
          </div>
        )}

        {results && results.auctions.length > 0 && (
          <section className="pub-search-group" aria-label="Auctions">
            <h2><Gavel size={18} /> Auctions <span>{results.auctions.length}</span></h2>
            <div className="pub-grid">{results.auctions.map((a) => <AuctionCard key={a.id} auction={a} offset={0} />)}</div>
          </section>
        )}

        {results && results.rtl.length > 0 && (
          <section className="pub-search-group" aria-label="Ready to Lift">
            <h2><Truck size={18} /> Ready to Lift <span>{results.rtl.length}</span></h2>
            <div className="pub-grid">{results.rtl.map((v) => <ReadyToLiftCard key={v.id} vehicle={v} />)}</div>
          </section>
        )}

        {results && results.parts.length > 0 && (
          <section className="pub-search-group" aria-label="Spare parts">
            <h2><Wrench size={18} /> Spare parts <span>{results.parts.length}</span></h2>
            <div className="pub-grid">
              {results.parts.map((p) => (
                <Link key={p.id} to="/spare-parts" className="pub-card">
                  <div className="pub-card-media">
                    {p.has_photo ? <img src={partPhotoUrl(p.id)} alt={p.name} loading="lazy" /> : <div className="pub-photo-empty"><Wrench size={34} /></div>}
                  </div>
                  <div className="pub-card-body">
                    <h3>{p.name}</h3>
                    <p className="pub-card-sub">{p.make}{p.model ? ` ${p.model}` : ''}</p>
                    <div className="pub-card-price"><div><span>Price</span><strong>{money(p.price)}</strong></div></div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
