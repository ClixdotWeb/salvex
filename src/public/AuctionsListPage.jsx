import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { CATEGORIES, categoryFromSlug, listAuctions } from '../api/auctions';
import { AuctionCard, EmptyState, clockOffset } from './shared';
import './public.css';

const TABS = [
  { phase: 'live', label: 'Live now', path: '/auctions/live' },
  { phase: 'upcoming', label: 'Upcoming', path: '/auctions/upcoming' },
  { phase: 'ended', label: 'Results', path: '/auctions/ended' },
];

const EMPTY_TEXT = {
  live: ['No live auctions right now', 'Check the upcoming auctions to see what starts next.'],
  upcoming: ['No upcoming auctions yet', 'New auctions are added regularly. Please check back soon.'],
  ended: ['No finished auctions yet', 'Results appear here once auctions close.'],
};

/** Grid of auctions for one phase. `limit` shows a short list (home page) with no "load more". */
export function AuctionGrid({ phase, limit, category = null }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (pageNumber, append) => {
    setLoading(true);
    try {
      const data = await listAuctions(phase, pageNumber, limit || 12, category);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setPage(data);
      setOffset(clockOffset(data.items[0]?.server_time));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [phase, limit, category]);

  useEffect(() => { load(1, false); }, [load]);

  useEffect(() => {                             // keep live prices fresh
    if (phase !== 'live') return undefined;
    const timer = setInterval(() => load(1, false), 15000);
    return () => clearInterval(timer);
  }, [phase, load]);

  if (error && items.length === 0) {
    return <div className="pub-error">Could not load auctions. <button type="button" onClick={() => load(1, false)}>Try again</button></div>;
  }
  if (loading && items.length === 0) return <div className="pub-loading"><Loader2 size={18} className="pub-spin" /> Loading auctions…</div>;
  if (items.length === 0) {
    const [title, text] = EMPTY_TEXT[phase];
    return <EmptyState title={title}>{text}</EmptyState>;
  }

  return (
    <>
      <div className="pub-grid">
        {items.map((a) => <AuctionCard key={a.id} auction={a} offset={offset} />)}
      </div>
      {!limit && page && page.page < page.pages && (
        <div className="pub-more">
          <button type="button" className="pub-btn" disabled={loading} onClick={() => load(page.page + 1, true)}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </>
  );
}

export default function AuctionsListPage({ phase }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const category = categoryFromSlug(params.get('category'));
  const withCategory = (path, slug) => (slug ? `${path}?category=${slug}` : path);
  return (
    <div className="pub-page">
      <div className="pub-container">
        <div className="pub-head">
          <div>
            <h1>{category ? `${category.label} auctions` : 'Vehicle auctions'}</h1>
            <p>Bid on verified salvage, insurance and repossessed vehicles. Times shown use the auction server's clock.</p>
          </div>
        </div>
        <div className="pub-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.phase} type="button" role="tab" aria-selected={phase === t.phase}
              className={phase === t.phase ? 'active' : ''} onClick={() => navigate(withCategory(t.path, category?.slug))}>{t.label}</button>
          ))}
        </div>
        <div className="pub-chips" aria-label="Category">
          <button type="button" data-testid="category-tab-all" className={!category ? 'active' : ''}
            onClick={() => navigate(TABS.find((t) => t.phase === phase).path)}>All categories</button>
          {CATEGORIES.map((c) => (
            <button key={c.slug} type="button" data-testid={`category-tab-${c.slug}`}
              className={category?.slug === c.slug ? 'active' : ''}
              onClick={() => navigate(withCategory(TABS.find((t) => t.phase === phase).path, c.slug))}>{c.label}</button>
          ))}
        </div>
        <AuctionGrid key={`${phase}-${category?.value || 'all'}`} phase={phase} category={category?.value || null} />
      </div>
    </div>
  );
}

/** Home page block: live auctions first, then upcoming ones. */
export function HomeAuctions() {
  return (
    <section className="pub-home-section">
      <div className="pub-container">
        <div className="pub-head">
          <div><h2>Live auctions</h2><p>Bidding is open now.</p></div>
          <Link to="/auctions/live" className="pub-link">View all <ArrowRight size={15} /></Link>
        </div>
        <AuctionGrid phase="live" limit={6} />
        <div className="pub-head spaced">
          <div><h2>Upcoming auctions</h2><p>Plan ahead: these open soon.</p></div>
          <Link to="/auctions/upcoming" className="pub-link">View all <ArrowRight size={15} /></Link>
        </div>
        <AuctionGrid phase="upcoming" limit={6} />
      </div>
    </section>
  );
}
