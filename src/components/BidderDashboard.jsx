import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, Car, CheckCircle2, FileText, Gavel, LayoutDashboard, Loader2, LogOut, MapPin, Search, ShieldCheck, Trophy, Truck, User, Wrench,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { listMyBids } from '../api/auctions';
import { publicPhotoUrl } from '../api/vehicles';
import { updateMe } from '../api/users';
import KycPanel from './KycPanel';
import MobileVerifyCard from './MobileVerifyCard';
import EmailVerifyCard from './EmailVerifyCard';
import OrdersPanel from './OrdersPanel';
import MyPartRequests from './MyPartRequests';
import { listMyOrders } from '../api/orders';
import { useSiteConfig } from '../api/site';
import './BidderDashboard.css';
import './BuyerDashboard.css';
import AccountMenu, { requestSignOut } from './AccountMenu';
import NotificationBell from './NotificationBell';

const KYC_LABELS = { pending: 'KYC pending', verified: 'KYC verified', rejected: 'KYC rejected' };
const TABS = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { id: 'my-bids', label: 'My bids', short: 'My bids', icon: Gavel },
  { id: 'won', label: 'Won auctions', short: 'Won', icon: Trophy },
  { id: 'documents', label: 'KYC & documents', short: 'KYC', icon: FileText },
  { id: 'parts', label: 'Part requests', short: 'Parts', icon: Wrench },
  { id: 'profile', label: 'Profile', short: 'Profile', icon: User },
];

const money = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

/** The bidder's own dashboard. Every figure comes from the server; nothing here is sample data. */
export default function BidderDashboard() {
  const { user } = useAuth();
  const site = useSiteConfig();
  const [params, setParams] = useSearchParams();
  const activeTab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (id) => setParams(id === 'overview' ? {} : { tab: id });

  const [bids, setBids] = useState(null);
  const [error, setError] = useState(null);
  const loadBids = useCallback(async () => {
    try {
      const data = await listMyBids();
      setBids(data.items);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { loadBids(); }, [loadBids]);
  const [orders, setOrders] = useState([]);
  useEffect(() => { listMyOrders().then(setOrders).catch(() => {}); }, []);
  const payable = orders.filter((o) => o.online_payment !== false && o.status === 'awaiting_payment');
  // the client's flow: no payment on the website, our team contacts the winner
  const toContact = orders.filter((o) => o.online_payment === false && o.status === 'awaiting_payment'
    && !(o.fee_pending !== null && o.fee_pending !== undefined && Number(o.fee_pending) === 0));
  useEffect(() => {                                       // outbid / won changes show up on their own
    const timer = setInterval(loadBids, 20000);
    return () => clearInterval(timer);
  }, [loadBids]);

  const open = (bids || []).filter((b) => b.phase !== 'ended');
  const leading = open.filter((b) => b.you_are_highest);
  const outbid = open.filter((b) => !b.you_are_highest);
  const won = (bids || []).filter((b) => b.you_won);
  const kycStatus = user?.kyc_status;

  const firstName = (user?.name || '').split(' ')[0];
  const current = TABS.find((t) => t.id === activeTab) || TABS[0];
  // Bidding needs approved KYC, a confirmed email and (when SMS codes are on) a confirmed mobile number.
  const mobileNeeded = Boolean(site?.mobile_otp) && user?.is_mobile_verified === false;
  const emailNeeded = user?.is_email_verified === false;
  const contactsReady = !mobileNeeded && !emailNeeded;
  const ready = kycStatus === 'verified' && contactsReady;

  return (
    <div className="salvex-bidder-dashboard-page bd-page">
      <div className="bd-frame">
        <aside className="bd-rail" aria-label="Dashboard sections">
          <Link to="/" className="bd-rail-brand" aria-label="Salvex home"><img src="/images/lg.png" alt="" /></Link>
          <nav className="bd-rail-nav">
            {TABS.map((t) => {
              const alert = (t.id === 'my-bids' && outbid.length > 0) || (t.id === 'won' && (payable.length > 0 || toContact.length > 0))
                || (t.id === 'documents' && !ready);
              return (
                <button key={t.id} type="button" className={`bd-rail-item ${activeTab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}
                  aria-current={activeTab === t.id ? 'page' : undefined} title={t.label}>
                  <span className="bd-rail-icon"><t.icon size={19} />{alert && <span className="bd-rail-dot" aria-hidden="true" />}</span>
                  <span className="bd-rail-label">{t.short || t.label}</span>
                </button>
              );
            })}
          </nav>
          <Link to="/auctions/live" className="bd-rail-item bd-rail-bottom" title="Browse live auctions">
            <span className="bd-rail-icon"><Search size={19} /></span><span className="bd-rail-label">Auctions</span>
          </Link>
          <button type="button" className="bd-rail-item bd-rail-signout" onClick={requestSignOut} title="Sign out">
            <span className="bd-rail-icon"><LogOut size={19} /></span><span className="bd-rail-label">Sign out</span>
          </button>
        </aside>

        <main className="bd-main">
          <header className="bd-top">
            <Link to="/" className="bd-top-home" aria-label="Salvex home"><img src="/images/lg.png" alt="" /></Link>
            <h1>{current.id === 'overview' ? 'Overview' : current.label}</h1>
            <div className="bd-top-right">
              <span className={`bd-kyc-chip kyc-${kycStatus}`}><ShieldCheck size={14} /> {KYC_LABELS[kycStatus] || kycStatus}</span>
              {/* The dashboard has no site menu above it: bell and account menu (with sign out) live here. */}
              <NotificationBell />
              <span className="bd-profile-text bd-top-name"><strong>{user?.name}</strong>{user?.buyer_id && <span>{user.buyer_id}</span>}</span>
              {user && <AccountMenu user={user} home="/dashboard" onLogout={requestSignOut} />}
            </div>
          </header>

          {error && <div className="kyc-alert kyc-alert-error"><AlertCircle size={16} /> <span>{error}</span></div>}

          {activeTab === 'overview' && (
            <div className="tab-pane-content bd-overview">
              <div className="bd-hero-row">
                <section className="bd-welcome">
                  <span className="bd-eyebrow">Welcome back</span>
                  <h2>Hi, {firstName}</h2>
                  <div className="bd-welcome-meta">
                    {user?.buyer_id && <span className="bd-chip"><User size={13} /> Buyer ID: <strong>{user.buyer_id}</strong></span>}
                    <span className="bd-chip">{user?.email}</span>
                    {user?.organization && <span className="bd-chip">{user.organization}</span>}
                  </div>
                  {ready ? (
                    <div className="bd-welcome-next ok">
                      <CheckCircle2 size={18} />
                      <span>Your identity is verified. You can bid on any live auction.</span>
                      <Link to="/auctions/live" className="salvex-btn salvex-btn-primary btn-sm">Browse live auctions <ArrowRight size={15} /></Link>
                    </div>
                  ) : kycStatus === 'verified' ? (
                    <div className="bd-welcome-next">
                      <ShieldCheck size={18} />
                      <span><strong>Verify your {mobileNeeded && emailNeeded ? 'mobile number and email' : mobileNeeded ? 'mobile number' : 'email address'} to start bidding.</strong> Use the code below.</span>
                    </div>
                  ) : (
                    <div className="bd-welcome-next">
                      <ShieldCheck size={18} />
                      <span><strong>Verify your identity to start bidding.</strong> It takes a few minutes and is needed only once.</span>
                      <button type="button" className="salvex-btn salvex-btn-primary btn-sm" onClick={() => setTab('documents')}>Complete KYC</button>
                    </div>
                  )}
                </section>

                <div className="bd-stats">
                  <StatCard icon={Gavel} tone="lavender" title="Active bids" value={bids ? open.length : '…'} onClick={() => setTab('my-bids')} />
                  <StatCard icon={CheckCircle2} tone="green" title="Leading" value={bids ? leading.length : '…'} onClick={() => setTab('my-bids')} />
                  <StatCard icon={AlertCircle} tone="rose" title="Outbid" value={bids ? outbid.length : '…'} onClick={() => setTab('my-bids')} />
                  <StatCard icon={Trophy} tone="amber" title="Won" value={bids ? won.length : '…'} onClick={() => setTab('won')} />
                </div>
              </div>

              {mobileNeeded && <MobileVerifyCard />}
              {emailNeeded && <EmailVerifyCard />}

              {toContact.length > 0 && (
                <div className="urgent-payment-banner won-banner bd-banner">
                  <div className="urgent-left">
                    <Trophy size={24} className="text-success" />
                    <div>
                      <h4>You won {toContact.length === 1 ? toContact[0].vehicle_title : `${toContact.length} auctions`}!</h4>
                      <p>Our team will contact you to complete the purchase. You do not need to pay on the website.</p>
                    </div>
                  </div>
                  <button type="button" className="salvex-btn salvex-btn-primary" onClick={() => setTab('won')}>View <ArrowRight size={15} /></button>
                </div>
              )}

              {payable.length > 0 && (
                <div className="urgent-payment-banner bd-banner">
                  <div className="urgent-left">
                    <Trophy size={24} className="text-success" />
                    <div>
                      <h4>You won {payable.length === 1 ? payable[0].vehicle_title : `${payable.length} auctions`}: payment due</h4>
                      <p>Pay before {new Date(payable[0].due_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. You cannot bid on other auctions until it is paid.</p>
                    </div>
                  </div>
                  <button type="button" className="salvex-btn salvex-btn-primary" onClick={() => setTab('won')}>Pay now <ArrowRight size={15} /></button>
                </div>
              )}

              <div className="bd-row">
                <section className="bd-card bd-bids-card">
                  <div className="bd-card-head">
                    <h3>Your active bids</h3>
                    <button type="button" className="link-view-all" onClick={() => setTab('my-bids')}>View all <ArrowRight size={14} /></button>
                  </div>
                  {!bids ? <Loading /> : open.length === 0 ? (
                    <Empty text="You have no active bids." link={{ to: '/auctions/live', label: 'Browse live auctions' }} />
                  ) : (
                    <div className="bd-bid-list">
                      {open.slice(0, 5).map((b) => <BidRow key={b.auction_id} bid={b} />)}
                    </div>
                  )}
                </section>

                <aside className="bd-side">
                  <div className="bd-promo">
                    <span className="bd-promo-pill"><Truck size={13} /> Ready to Lift</span>
                    <h3>Vehicles ready <em>now</em>, no auction</h3>
                    <p>No bidding and no waiting. Tap &quot;I&apos;m interested&quot; and our team calls you.</p>
                    <Link to="/ready-to-lift" className="bd-promo-btn">View vehicles <ArrowRight size={15} /></Link>
                    <span className="bd-promo-art" aria-hidden="true" />
                  </div>
                  <button type="button" className="bd-mini-card" onClick={() => setTab('parts')}>
                    <span className="bd-mini-icon"><Wrench size={18} /></span>
                    <span><strong>Need a spare part?</strong><small>Ask us and we call you back</small></span>
                    <ArrowRight size={16} />
                  </button>
                </aside>
              </div>
            </div>
          )}

          {activeTab === 'my-bids' && (
            <div className="tab-pane-content bd-card">
              <div className="tab-pane-header"><h2>My bids</h2><p>Every auction you have bid on, newest activity first. This list refreshes on its own.</p></div>
              {!bids ? <Loading /> : bids.length === 0 ? (
                <Empty text="You have not bid yet." link={{ to: '/auctions/live', label: 'Browse live auctions' }} />
              ) : (
                <div className="bd-bid-list">{bids.map((b) => <BidRow key={b.auction_id} bid={b} />)}</div>
              )}
            </div>
          )}

          {activeTab === 'won' && (
            <div className="tab-pane-content bd-card">
              {site?.online_payment === false ? (
                <div className="tab-pane-header"><h2>Won auctions</h2><p>Vehicles you won. Our team contacts you to complete each purchase, the documents and the handover. You do not pay on the website.</p></div>
              ) : (
                <div className="tab-pane-header"><h2>Won auctions & payments</h2><p>Pay each win before its deadline. Payments are confirmed by our team after checking the bank statement.</p></div>
              )}
              <OrdersPanel onChange={setOrders} />
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="tab-pane-content bd-card">
              <div className="tab-pane-header"><h2>KYC & documents</h2><p>Verify your identity once to bid on any auction.</p></div>
              {mobileNeeded && <div className="bd-mobile-verify"><MobileVerifyCard /></div>}
              {emailNeeded && <div className="bd-mobile-verify"><EmailVerifyCard /></div>}
              <KycPanel />
            </div>
          )}

          {activeTab === 'parts' && (
            <div className="tab-pane-content bd-card">
              <div className="tab-pane-header"><h2>Part requests</h2><p>Spare parts you asked for. Our team calls you about each one.</p></div>
              <MyPartRequests />
            </div>
          )}

          {activeTab === 'profile' && <div className="bd-card"><ProfileTab /></div>}
        </main>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, tone, title, value, onClick }) {
  return (
    <button type="button" className={`bd-stat tone-${tone}`} onClick={onClick}>
      <span className="bd-stat-top"><span className="bd-stat-icon"><Icon size={18} /></span><ArrowRight size={15} className="bd-stat-go" /></span>
      <span className="bd-stat-number">{value}</span>
      <span className="bd-stat-title">{title}</span>
    </button>
  );
}

function BidRow({ bid }) {
  let status = { cls: 'winning', label: 'Leading' };
  if (bid.you_won) status = { cls: 'won', label: 'Won' };
  else if (bid.phase === 'ended') status = { cls: 'lost', label: 'Not won' };
  else if (!bid.you_are_highest) status = { cls: 'outbid', label: 'Outbid' };

  return (
    <Link to={`/auctions/${bid.auction_id}`} className="bd-bid-row">
      <span className="bd-bid-thumb">
        {bid.photo_id ? <img src={publicPhotoUrl(bid.vehicle_id, bid.photo_id, 'thumb')} alt={bid.title} /> : <Car size={22} />}
      </span>
      <span className="bd-bid-main">
        <strong>{bid.title}</strong>
        <span><MapPin size={12} /> {bid.registration_masked} · your highest {money(bid.my_highest_bid)}</span>
      </span>
      <span className={`bd-bid-status status-badge-chip ${status.cls}`}>{status.label}</span>
      <span className="bd-bid-price"><small>{bid.phase === 'ended' ? 'Final price' : 'Current bid'}</small><strong>{money(bid.current_price)}</strong></span>
      <span className="bd-bid-act">
        {status.cls === 'outbid' ? <span className="salvex-btn salvex-btn-primary btn-sm">Bid again</span> : <span className="link-view-all">Open <ArrowRight size={14} /></span>}
      </span>
    </Link>
  );
}

function ProfileTab() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ name: user?.name || '', mobile: user?.mobile || '', organization: user?.organization || '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v.trim() !== (user?.[k] || '')).map(([k, v]) => [k, v.trim()]));
    if (Object.keys(changes).length === 0) { setMessage({ ok: true, text: 'Nothing to change.' }); return; }
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await updateMe(changes);
      await refresh();
      setMessage({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setErrors(err.fieldErrors || {});
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab-pane-content">
      <div className="tab-pane-header"><h2>Profile</h2><p>Your email and role cannot be changed here. Contact support if they are wrong.</p></div>
      <form className="profile-form-grid" onSubmit={save}>
        <div className="form-field">
          <label htmlFor="pf-name">Full name</label>
          <input id="pf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {errors.name && <small className="text-red">{errors.name}</small>}
        </div>
        <div className="form-field">
          <label htmlFor="pf-org">Organization (optional)</label>
          <input id="pf-org" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          {errors.organization && <small className="text-red">{errors.organization}</small>}
        </div>
        <div className="form-field">
          <label htmlFor="pf-email">Email</label>
          <input id="pf-email" value={user?.email || ''} readOnly />
        </div>
        <div className="form-field">
          <label htmlFor="pf-mobile">Mobile number</label>
          <input id="pf-mobile" type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          {errors.mobile && <small className="text-red">{errors.mobile}</small>}
        </div>
        <div className="form-field full-width">
          {message && <p className={message.ok ? 'text-success' : 'text-red'} role="status">{message.text}</p>}
          <button type="submit" className="salvex-btn salvex-btn-primary" disabled={busy}>
            {busy && <Loader2 size={15} className="kyc-spin" />} Save profile
          </button>
        </div>
      </form>
    </div>
  );
}

function Loading() {
  return <div className="kyc-panel kyc-loading"><Loader2 size={18} className="kyc-spin" /> Loading…</div>;
}

function Empty({ text, link }) {
  return (
    <div className="salvex-empty-state">
      <Gavel size={36} className="text-muted" />
      <h3>{text}</h3>
      {link && <Link to={link.to} className="salvex-btn salvex-btn-primary btn-sm">{link.label}</Link>}
    </div>
  );
}
