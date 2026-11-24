import React, { useEffect, useRef, useState } from 'react';
import { Car, ExternalLink, Gavel, Hand, Loader2, MessageCircle, Phone, Search, ShieldCheck, User, Wrench, X } from 'lucide-react';
import { adminSearch, getBuyerOverview, getVehicleOverview } from '../api/admin';
import { ownPhotoUrl, vehicleTitle } from '../api/vehicles';
import { ENQUIRY_STATUS } from '../api/readyToLift';
import { REQUEST_STATUS } from '../api/parts';
import { AdmTable, Badge, Empty, ErrorBox, Modal, Spinner, dateTime, money, useLoad } from './ui';

const digits = (phone) => (phone || '').replace(/[^0-9+]/g, '');
const PHASE_TAB = { upcoming: 'upcoming', live: 'live', closing: 'live', paused: 'live', ended: 'ended', cancelled: 'ended' };

/**
 * The search box at the top of the admin: Buyer ID, name, phone or email finds people;
 * registration or claim number finds vehicles. Choosing a result opens its full details.
 */
export function AdminSearchBox({ onOpen }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const box = useRef(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setState({ loading: false, data: null, error: null }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      adminSearch(text)
        .then((data) => { if (alive) setState({ loading: false, data, error: null }); })
        .catch((err) => { if (alive) setState({ loading: false, data: null, error: err.message }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  useEffect(() => {
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (item) => { setOpen(false); setQ(''); onOpen(item); };
  const { data } = state;
  const first = data?.buyers[0] ? { type: 'buyer', id: data.buyers[0].id } : data?.vehicles[0] ? { type: 'vehicle', id: data.vehicles[0].id } : null;

  return (
    <div className="adm-global-search" ref={box}>
      <Search size={17} className="adm-gs-icon" aria-hidden="true" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && first) choose(first); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Search Buyer ID, name, phone, registration or claim number" aria-label="Search buyers and vehicles" />
      {state.loading && <Loader2 size={16} className="adm-spin adm-gs-busy" />}
      {q && <button type="button" className="adm-gs-clear" aria-label="Clear search" onClick={() => setQ('')}><X size={15} /></button>}
      {open && q.trim().length >= 2 && (data || state.error) && (
        <div className="adm-gs-results" role="listbox" aria-label="Search results">
          {state.error && <p className="adm-gs-empty">{state.error}</p>}
          {data && data.buyers.length === 0 && data.vehicles.length === 0 && <p className="adm-gs-empty">Nothing found for “{data.q}”.</p>}
          {data?.buyers.length > 0 && <p className="adm-gs-group"><User size={13} /> Buyers</p>}
          {data?.buyers.map((b) => (
            <button key={b.id} type="button" role="option" aria-selected="false" className="adm-gs-item" onClick={() => choose({ type: 'buyer', id: b.id })}>
              <span className="adm-gs-avatar">{(b.name || '?').slice(0, 1).toUpperCase()}</span>
              <span className="adm-gs-main"><strong>{b.name}</strong><span>{[b.buyer_id, b.mobile || b.email].filter(Boolean).join(' · ')}</span></span>
              <Badge value={b.kyc_status} label={`KYC ${b.kyc_status}`} />
            </button>
          ))}
          {data?.vehicles.length > 0 && <p className="adm-gs-group"><Car size={13} /> Vehicles</p>}
          {data?.vehicles.map((v) => (
            <button key={v.id} type="button" role="option" aria-selected="false" className="adm-gs-item" onClick={() => choose({ type: 'vehicle', id: v.id })}>
              <span className="adm-gs-thumb">{v.cover_photo_id ? <img src={ownPhotoUrl(v.id, v.cover_photo_id, 'thumb')} alt="" /> : <Car size={16} />}</span>
              <span className="adm-gs-main"><strong>{v.title}</strong><span className="mono">{v.registration_number} · {v.claim_number}</span></span>
              <Badge value={v.sold ? 'ended' : v.listing_type === 'ready_to_lift' ? 'live' : v.status}
                label={v.sold ? 'Sold' : v.listing_type === 'ready_to_lift' ? 'Ready to Lift' : v.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full details of one buyer. `go` jumps to another admin screen (closing this window). */
export function BuyerOverview({ id, onClose, go }) {
  const { data: b, error, loading, reload } = useLoad(() => getBuyerOverview(id), [id]);
  if (!b) return <Modal title="Buyer" onClose={onClose} wide>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;
  return (
    <Modal title={`${b.name} · ${b.buyer_id || b.role}`} onClose={onClose} wide>
      <div className="adm-detail adm-overview">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-card-head"><h4>Contact</h4>{!b.is_active && <Badge value="rejected" label="Suspended" />}</div>
            <dl className="adm-dl">
              <dt>Buyer ID</dt><dd className="mono"><strong>{b.buyer_id || '—'}</strong></dd>
              <dt>Mobile</dt><dd>{b.mobile || '—'}{b.mobile && (b.is_mobile_verified ? '' : ' (not verified)')}</dd>
              <dt>Email</dt><dd>{b.email}{b.is_email_verified ? '' : ' (not verified)'}</dd>
              {b.organization && <><dt>Organisation</dt><dd>{b.organization}</dd></>}
              <dt>Joined</dt><dd>{dateTime(b.created_at)}</dd>
            </dl>
            <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
              {b.mobile && <a className="adm-btn small primary" href={`tel:${digits(b.mobile)}`}><Phone size={14} /> Call</a>}
              {b.mobile && <a className="adm-btn small" href={`https://wa.me/${digits(b.mobile).replace('+', '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
            </div>
          </div>
          <div className="adm-card">
            <h4>Activity</h4>
            <div className="adm-ov-stats">
              <div><strong>{b.bids_total}</strong><span>bids</span></div>
              <div><strong>{b.auctions_bid_on}</strong><span>auctions bid on</span></div>
              <div><strong>{b.won.length}</strong><span>won</span></div>
              <div><strong>{b.vehicle_enquiries.length + b.part_enquiries.length}</strong><span>enquiries</span></div>
            </div>
            <dl className="adm-dl">
              <dt>KYC</dt>
              <dd>
                <Badge value={b.kyc_status} label={b.kyc_status} />{' '}
                {b.kyc_submission_id && <button type="button" className="adm-link" onClick={() => go('kyc', null, b.kyc_submission_id)}><ShieldCheck size={13} /> Open KYC</button>}
              </dd>
            </dl>
          </div>
        </div>

        <div className="adm-card">
          <h4><Gavel size={15} /> Auctions won ({b.won.length})</h4>
          {b.won.length === 0 ? <p className="adm-muted">No auction won yet.</p> : (
            <AdmTable>
              <thead><tr><th>Vehicle</th><th>Winning bid</th><th>Closed</th><th>Service fee</th><th /></tr></thead>
              <tbody>
                {b.won.map((w) => (
                  <tr key={w.auction_id} className="clickable" onClick={() => go('results', 'sold', w.auction_id)}>
                    <td className="adm-cell-main">
                      <div className="adm-two-line"><strong>{w.vehicle_title}</strong><span className="mono">{w.registration_number}</span></div>
                      <DealState deal={w.deal} />
                    </td>
                    <td>{money(w.amount)}</td>
                    <td>{dateTime(w.closed_at)}</td>
                    <td>{w.deal?.service_fee == null ? <span className="adm-muted">Not set</span>
                      : <div className="adm-two-line"><strong>{money(w.deal.service_fee)}</strong><span>received {money(w.deal.fee_received)} · pending {money(w.deal.fee_pending)}</span></div>}</td>
                    <td className="right"><button type="button" className="adm-btn small">Deal</button></td>
                  </tr>
                ))}
              </tbody>
            </AdmTable>
          )}
        </div>

        {b.recent_bids.length > 0 && (
          <div className="adm-card">
            <h4>Recent bids</h4>
            <AdmTable>
              <thead><tr><th>Vehicle</th><th>Bid</th><th>When</th><th>Auction</th></tr></thead>
              <tbody>
                {b.recent_bids.map((r) => (
                  <tr key={`${r.auction_id}-${r.created_at}`} className="clickable" onClick={() => go('auctions', PHASE_TAB[r.auction_phase] || 'ended', r.auction_id)}>
                    <td className="adm-cell-main"><div className="adm-two-line"><strong>{r.vehicle_title}</strong><span className="mono">{r.registration_number}</span></div></td>
                    <td>{money(r.amount)}</td>
                    <td>{dateTime(r.created_at)}</td>
                    <td><Badge value={r.auction_phase} /></td>
                  </tr>
                ))}
              </tbody>
            </AdmTable>
          </div>
        )}

        <div className="adm-grid-2">
          <EnquiryList icon={Hand} title="Vehicle enquiries" items={b.vehicle_enquiries} statuses={ENQUIRY_STATUS}
            onOpen={(e) => go('enquiries', '', e.id)} />
          <EnquiryList icon={Wrench} title="Spare part enquiries" items={b.part_enquiries} statuses={REQUEST_STATUS}
            onOpen={(e) => go('part-enquiries', '', e.id)} />
        </div>
      </div>
    </Modal>
  );
}

/** In progress / Completed / Sale cancelled (with the reason) for a won auction's deal. */
function DealState({ deal }) {
  if (!deal) return null;
  if (deal.status === 'cancelled') return <Badge value="cancelled" label={`Sale cancelled${deal.status_reason ? `: ${deal.status_reason}` : ''}`} />;
  if (deal.status === 'paid') return <Badge value="approved" label="Deal completed" />;
  return <Badge value="pending" label="Deal in progress" />;
}

function EnquiryList({ icon: Icon, title, items, statuses, onOpen }) {
  return (
    <div className="adm-card">
      <h4><Icon size={15} /> {title} ({items.length})</h4>
      {items.length === 0 ? <p className="adm-muted">None.</p> : (
        <ul className="adm-ov-list">
          {items.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onOpen(e)}>
                <span className="adm-two-line"><strong>{e.what}</strong><span>{e.number} · {dateTime(e.created_at)}</span></span>
                <Badge value={statuses[e.status]?.badge || statuses[e.status]?.tone} label={statuses[e.status]?.label || e.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full details of one vehicle: details, photos, every auction (winner, deal) and the enquiries. */
export function VehicleOverview({ id, onClose, go, onOpen }) {
  const { data, error, loading, reload } = useLoad(() => getVehicleOverview(id), [id]);
  if (!data) return <Modal title="Vehicle" onClose={onClose} wide>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;
  const v = data.vehicle;
  const rtl = v.listing_type === 'ready_to_lift';
  const openVehicle = () => (rtl ? go('ready-to-lift', 'all', v.id) : go('auctions', 'waiting', v.id));
  return (
    <Modal title={`${vehicleTitle(v)} · ${v.registration_number}`} onClose={onClose} wide>
      <div className="adm-detail adm-overview">
        <div className="adm-inline">
          <Badge value={rtl ? 'live' : 'upcoming'} label={rtl ? 'Ready to Lift' : 'Auction'} />
          <Badge value={v.status} />
          {data.sold && <Badge value="ended" label="Sold" />}
          <button type="button" className="adm-btn small" onClick={openVehicle}><ExternalLink size={13} /> Open to edit / photos</button>
        </div>
        {v.photos.length > 0 && (
          <div className="adm-ov-photos">
            {v.photos.map((p, i) => <img key={p.id} src={ownPhotoUrl(v.id, p.id, 'thumb')} alt={`Photo ${i + 1}`} loading="lazy" />)}
          </div>
        )}
        <div className="adm-card">
          <h4>Details</h4>
          <dl className="adm-dl adm-dl-2col">
            <dt>Registration</dt><dd className="mono">{v.registration_number}</dd>
            <dt>Claim number</dt><dd className="mono">{v.claim_number}</dd>
            <dt>Make / model</dt><dd>{v.make} {v.model} {v.variant}</dd>
            <dt>Years</dt><dd>made {v.manufacturing_year} · registered {v.registration_year}</dd>
            <dt>Fuel / gear</dt><dd>{v.fuel_type} · {v.transmission}</dd>
            <dt>Owners</dt><dd>{v.number_of_owners}</dd>
            {v.km_driven != null && <><dt>KM driven</dt><dd>{Number(v.km_driven).toLocaleString('en-IN')}</dd></>}
            {v.superdari != null && <><dt>Superdari</dt><dd>{v.superdari ? 'Yes' : 'No'}</dd></>}
            <dt>Damage</dt><dd>{v.damage_type === 'other' && v.damage_other ? v.damage_other : v.damage_type}</dd>
            <dt>Location</dt><dd>{v.location}</dd>
            <dt>RC / registration</dt><dd>{v.rc_status} · {v.registration_type}</dd>
            <dt>Hypothecation</dt><dd>{v.hypothecation_status}</dd>
            {!rtl && <><dt>Category</dt><dd>{v.category}</dd></>}
            <dt>Added</dt><dd>{dateTime(v.created_at)}</dd>
          </dl>
        </div>

        {!rtl && (
          <div className="adm-card">
            <h4><Gavel size={15} /> Auctions ({data.auctions.length})</h4>
            {data.auctions.length === 0 ? <Empty>No auction yet. Open the vehicle and start one from Auctions &gt; Waiting.</Empty> : (
              <AdmTable>
                <thead><tr><th>Auction</th><th>Price</th><th>Bids</th><th>Winner</th><th>Service fee</th></tr></thead>
                <tbody>
                  {data.auctions.map((a) => (
                    <tr key={a.auction_id} className="clickable"
                      onClick={() => (a.result === 'sold' ? go('results', 'sold', a.auction_id) : go('auctions', PHASE_TAB[a.phase] || 'ended', a.auction_id))}>
                      <td><div className="adm-two-line"><span className="adm-badges"><Badge value={a.phase} />{a.result && <Badge value={a.result} label={a.result === 'sold' ? 'Sold' : 'No sale'} />}<DealState deal={a.deal} /></span><span>{dateTime(a.starts_at)} → {dateTime(a.ends_at)}</span></div></td>
                      <td><div className="adm-two-line"><strong>{money(a.current_price ?? a.starting_price)}</strong><span>from {money(a.starting_price)}</span></div></td>
                      <td>{a.bid_count}</td>
                      <td>{a.winner_id ? (
                        <button type="button" className="adm-link" onClick={(e) => { e.stopPropagation(); onOpen({ type: 'buyer', id: a.winner_id }); }}>
                          {a.winner_name} · {a.winner_buyer_id}
                        </button>
                      ) : '—'}</td>
                      <td>{a.deal?.service_fee == null ? <span className="adm-muted">—</span> : `${money(a.deal.fee_received)} of ${money(a.deal.service_fee)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </AdmTable>
            )}
          </div>
        )}

        <div className="adm-card">
          <h4><Hand size={15} /> Enquiries ({data.enquiries.length})</h4>
          {data.enquiries.length === 0 ? <p className="adm-muted">{rtl ? 'Nobody has tapped "I\'m interested" yet.' : 'Enquiries are for Ready to Lift vehicles.'}</p> : (
            <ul className="adm-ov-list">
              {data.enquiries.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen({ type: 'buyer', id: e.buyer_user_id })}>
                    <span className="adm-two-line"><strong>{e.buyer_name} · {e.buyer_id}</strong><span>{e.buyer_mobile || 'no phone'} · {e.number} · {dateTime(e.created_at)}</span></span>
                    <Badge value={ENQUIRY_STATUS[e.status]?.tone} label={ENQUIRY_STATUS[e.status]?.label || e.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

