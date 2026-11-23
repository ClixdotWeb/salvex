import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3, Gavel, Truck, Hand, Inbox, LayoutDashboard, LogOut, Package, ReceiptIndianRupee, ScrollText, ShieldCheck, Trophy, Users, Wrench,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import AccountMenu, { requestSignOut } from '../components/AccountMenu';
import NotificationBell from '../components/NotificationBell';
import { DEMO_PERSONAS_ENABLED } from '../auth/demo';
import { useSiteConfig } from '../api/site';
import { getDashboard } from '../api/admin';
import AdminDashboard from './AdminDashboard';
import AdminKyc from './AdminKyc';
import AdminVehicles from './AdminVehicles';
import AdminAuctions from './AdminAuctions';
import AdminUsers from './AdminUsers';
import AdminOrders from './AdminOrders';
import { PartEnquiries, PartsCatalogue } from './AdminParts';
import AdminAudit from './AdminAudit';
import AdminMessages from './AdminMessages';
import AdminResults from './AdminResults';
import AdminReports from './AdminReports';
import AdminEnquiries from './AdminEnquiries';
import { AdminSearchBox, BuyerOverview, VehicleOverview } from './AdminSearch';
import './Admin.css';

// The sidebar, in groups. `count` names the dashboard number shown as a badge (things waiting for the admin).
const GROUPS = [
  { items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Enquiries',
    items: [
      { id: 'enquiries', label: 'Vehicle enquiries', icon: Hand, count: 'enquiries_new' },
      { id: 'part-enquiries', label: 'Spare part enquiries', icon: Wrench, count: 'part_requests_new' },
      { id: 'messages', label: 'Contact messages', icon: Inbox, count: 'contact_messages_new' },
    ],
  },
  {
    title: 'Vehicles & auctions',
    items: [
      { id: 'auctions', label: 'Auctions', icon: Gavel },
      { id: 'ready-to-lift', label: 'Ready to Lift', icon: Truck },
      { id: 'results', label: 'Results & fees', icon: Trophy },
      { id: 'orders', label: 'Orders & payments', icon: ReceiptIndianRupee, onlinePaymentOnly: true },
    ],
  },
  {
    title: 'Buyers',
    items: [
      { id: 'kyc', label: 'KYC verification', icon: ShieldCheck, count: 'kyc_waiting_review' },
      { id: 'users', label: 'Users', icon: Users },
    ],
  },
  {
    title: 'More',
    items: [
      { id: 'parts', label: 'Spare parts catalogue', icon: Package },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.items);

// Older links: tab=vehicles = the Waiting tab of Auctions; tab=parts with a request = Spare part enquiries.
const SUB_TABS = { vehicles: 'auctions' };
function tabFrom(params) {
  const tab = params.get('tab');
  if (tab === 'parts' && (params.get('open') || params.get('status'))) return 'part-enquiries';
  return ALL.some((s) => s.id === tab) || SUB_TABS[tab] ? tab : 'dashboard';
}


/** The administrator console. Every screen reads and writes real data through /api/admin. */
export default function AdminConsole() {
  const { user, demoRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const site = useSiteConfig();
  const [auctionVehicle, setAuctionVehicle] = useState(null);
  const [counts, setCounts] = useState({});
  const [overview, setOverview] = useState(null);    // { type: 'buyer' | 'vehicle', id } from the search
  const tab = tabFrom(params);
  // A link such as /admin?tab=enquiries&status=new&open=<id> (from a notification) selects the filter and opens
  // that record straight away. Closing it removes "open" from the address.
  const open = params.get('open');
  const linkStatus = params.get('status');
  const deepLink = { id: open, status: linkStatus, month: params.get('month') };
  const go = (id, status, openId) => {
    setOverview(null);
    setParams(id === 'dashboard' ? {} : { tab: id, ...(status != null ? { status } : {}), ...(openId ? { open: openId } : {}) });
  };
  const closeLink = () => {
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  };
  const link = { deepLink, onDeepLinkClose: closeLink };

  // Badges: refreshed when the admin moves between sections and every minute.
  useEffect(() => {
    let alive = true;
    const load = () => getDashboard().then((d) => { if (alive) setCounts(d); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [tab, open]);

  const visible = (s) => !s.onlinePaymentOnly || site?.online_payment;

  return (
    <div className="adm-page">
      <div className="adm-shell">
        <aside className="adm-sidebar">
          <div className="adm-brand">
            <span className="adm-brand-mark"><img src="/images/lg.png" alt="" /></span>
            <div><strong>Salvex Admin</strong><span>{user?.name}</span></div>
          </div>
          <nav className="adm-nav" aria-label="Admin sections">
            {GROUPS.map((group) => (
              <React.Fragment key={group.title || 'main'}>
                {group.title && <span className="adm-nav-group">{group.title}</span>}
                {group.items.filter(visible).map((s) => {
                  const n = s.count ? counts[s.count] || 0 : 0;
                  return (
                    <button key={s.id} type="button" className={tab === s.id || SUB_TABS[tab] === s.id ? 'active' : ''} onClick={() => go(s.id)}
                      aria-label={n ? `${s.label} (${n} new)` : s.label}>
                      <s.icon size={17} /> <span>{s.label}</span>
                      {n > 0 && <span className="adm-nav-count">{n > 99 ? '99+' : n}</span>}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </nav>
          <button type="button" className="adm-signout" onClick={requestSignOut}><LogOut size={17} /> <span>Sign out</span></button>
        </aside>

        <div className="adm-main-wrap">
        {/* own top bar: the admin page has no site menu above it */}
        <div className="adm-topbar">
          <AdminSearchBox onOpen={setOverview} />
          {DEMO_PERSONAS_ENABLED && demoRole && <span className="navbar-demo-badge">Demo screens, not signed in</span>}
          <NotificationBell />
          {user && <AccountMenu user={user} home="/admin" onLogout={requestSignOut} />}
        </div>
        <main className="adm-main" key={`${tab}|${linkStatus || ''}|${open || ''}`}>
          {tab === 'dashboard' && <AdminDashboard go={go} />}
          {tab === 'kyc' && <AdminKyc {...link} />}
          {tab === 'vehicles' && <AdminAuctions deepLink={{ ...deepLink, status: 'waiting' }} onDeepLinkClose={closeLink} />}
          {tab === 'ready-to-lift' && <AdminVehicles listing="ready_to_lift" {...link} onAuction={(v) => { setAuctionVehicle(v); go('auctions'); }} />}
          {tab === 'auctions' && <AdminAuctions {...link} preselectVehicle={auctionVehicle} clearPreselect={() => setAuctionVehicle(null)} />}
          {tab === 'results' && <AdminResults {...link} />}
          {tab === 'reports' && <AdminReports {...link} go={go} />}
          {tab === 'enquiries' && <AdminEnquiries {...link} />}
          {tab === 'part-enquiries' && <PartEnquiries {...link} />}
          {tab === 'orders' && <AdminOrders {...link} />}
          {tab === 'parts' && <PartsCatalogue />}
          {tab === 'messages' && <AdminMessages {...link} />}
          {tab === 'users' && <AdminUsers />}
          {tab === 'audit' && <AdminAudit />}
        </main>
        </div>
        {overview?.type === 'buyer' && <BuyerOverview id={overview.id} onClose={() => setOverview(null)} go={go} />}
        {overview?.type === 'vehicle' && <VehicleOverview id={overview.id} onClose={() => setOverview(null)} go={go} onOpen={setOverview} />}
      </div>
    </div>
  );
}
