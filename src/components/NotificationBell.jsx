import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, BellOff, Car, CheckCheck, ChevronRight, FileBarChart, Gavel, Hand, Inbox, Landmark, Loader2, ShieldCheck, TrendingDown,
  Trophy, Wrench, X, XCircle,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import './NotificationBell.css';

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// icon and colour for each kind of notification
const KINDS = {
  auction_won: [Trophy, 'amber'],
  deal_completed: [Trophy, 'green'],
  vehicle_sold: [Trophy, 'green'],
  auction_no_sale: [Gavel, 'slate'],
  auction_lost: [Gavel, 'slate'],
  outbid: [TrendingDown, 'rose'],
  enquiry_new: [Hand, 'lavender'],
  part_request_new: [Wrench, 'rose'],
  kyc_submitted: [ShieldCheck, 'amber'],
  kyc_decision: [ShieldCheck, 'sky'],
  contact_new: [Inbox, 'slate'],
  monthly_report: [FileBarChart, 'sky'],
  vehicle_review: [Car, 'sky'],
  vehicle_submitted: [Car, 'sky'],
  fee_received: [Landmark, 'green'],
  payment_confirmed: [Landmark, 'green'],
  payment_submitted: [Landmark, 'amber'],
  payment_reminder: [Landmark, 'amber'],
  payment_rejected: [AlertTriangle, 'rose'],
  order_cancelled: [XCircle, 'rose'],
  order_defaulted: [XCircle, 'rose'],
};

/** The bell in the top bar: unread count (checked every 30 s) and the latest notifications. */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const box = useRef(null);

  const refreshCount = useCallback(async () => {
    try { setUnread((await apiRequest('/api/notifications/unread-count', { notifyUnauthorized: false })).unread); } catch { /* signed out */ }
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, 30000);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(null);
      setOnlyUnread(false);
      try { setItems((await apiRequest('/api/notifications?page_size=10')).items); } catch { setItems([]); }
    }
  };

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) {
      try { await apiRequest(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* not important */ }
      refreshCount();
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    try { await apiRequest('/api/notifications/read-all', { method: 'POST' }); } catch { return; }
    setUnread(0);
    setItems((list) => (list || []).map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  };

  const shown = (items || []).filter((n) => !onlyUnread || !n.read_at);

  return (
    <div className="nbell" ref={box}>
      <button type="button" className="navbar-action-icon-btn nav-round" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={21} strokeWidth={2} />
        {unread > 0 && <span className="navbar-action-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="nbell-panel" role="dialog" aria-label="Notifications">
          <div className="nbell-head">
            <div className="nbell-head-row">
              <span className="nbell-head-icon"><Bell size={17} /></span>
              <strong>Notifications</strong>
              {unread > 0 && <span className="nbell-count">{unread > 99 ? '99+' : unread} new</span>}
              <button type="button" className="nbell-close" onClick={() => setOpen(false)} aria-label="Close notifications"><X size={16} /></button>
            </div>
            <div className="nbell-tools">
              <div className="nbell-filter" role="group" aria-label="Show">
                <button type="button" className={onlyUnread ? '' : 'on'} aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>All</button>
                <button type="button" className={onlyUnread ? 'on' : ''} aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>Unread</button>
              </div>
              {unread > 0 && <button type="button" className="nbell-readall" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}
            </div>
          </div>

          {items === null ? (
            <div className="nbell-empty"><Loader2 size={20} className="kyc-spin" /><span>Loading…</span></div>
          ) : shown.length === 0 ? (
            <div className="nbell-empty">
              <span className="nbell-empty-icon"><BellOff size={22} /></span>
              <strong>{onlyUnread ? 'All caught up' : 'No notifications yet'}</strong>
              <span>{onlyUnread ? 'You have read every notification.' : 'Updates about auctions and enquiries show up here.'}</span>
            </div>
          ) : (
            <ul className="nbell-list">
              {shown.map((n) => {
                const [Icon, tone] = KINDS[n.kind] || [Bell, 'sky'];
                return (
                  <li key={n.id}>
                    <button type="button" className={`nbell-item${n.read_at ? '' : ' unread'}`} onClick={() => openItem(n)}>
                      <span className={`nbell-icon tone-${tone}`}><Icon size={17} /></span>
                      <span className="nbell-text">
                        <span className="nbell-title">{n.title}</span>
                        <span className="nbell-body">{n.body}</span>
                        <span className="nbell-time">{ago(n.created_at)}</span>
                      </span>
                      {n.read_at ? <ChevronRight size={16} className="nbell-go" /> : <span className="nbell-dot" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
