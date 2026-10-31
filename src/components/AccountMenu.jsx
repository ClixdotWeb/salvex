import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, UserCircle } from 'lucide-react';

/** Ask the app to sign out (App.jsx listens, ends the session and shows the message). Used outside the top bar. */
export const requestSignOut = () => window.dispatchEvent(new Event('salvex:signout'));

/** The round avatar in the top bar. Click it for: who you are, your dashboard, profile and sign out. */
export default function AccountMenu({ user, home, onLogout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const firstName = (user.name || '').trim().split(' ')[0];
  const initial = (firstName[0] || '?').toUpperCase();
  const isBuyer = user.role === 'bidder';

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const goTo = (path) => { setOpen(false); navigate(path); };

  return (
    <div className="acct" ref={box} id="nav-user-chip">
      <button type="button" className="navbar-avatar" id="nav-avatar" onClick={() => setOpen((o) => !o)}
        aria-label={`My account (${firstName})`} aria-haspopup="menu" aria-expanded={open} title={user.name}>
        {initial}
      </button>
      {open && (
        <div className="acct-menu" role="menu" aria-label="My account">
          <div className="acct-head">
            <span className="acct-avatar" aria-hidden="true">{initial}</span>
            <span className="acct-who">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              {isBuyer && user.buyer_id && <span className="acct-id">Buyer ID: {user.buyer_id}</span>}
            </span>
          </div>
          <div className="acct-items">
            <button type="button" role="menuitem" onClick={() => goTo(home)}><LayoutDashboard size={17} /> My dashboard</button>
            {isBuyer && <button type="button" role="menuitem" onClick={() => goTo('/dashboard?tab=profile')}><UserCircle size={17} /> Profile</button>}
          </div>
          <div className="acct-items">
            <button type="button" role="menuitem" className="acct-signout" id="nav-signout-btn" onClick={() => { setOpen(false); onLogout(); }}>
              <LogOut size={17} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
