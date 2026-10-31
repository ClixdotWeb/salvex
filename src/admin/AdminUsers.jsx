import React, { useState } from 'react';
import { RefreshCcw, Search, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { changeUserRole, getUser, listUsers, reactivateUser, suspendUser, unblockBidding } from '../api/admin';
import { ActionDialog, AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, dateTime, useLoad } from './ui';
import Select from '../components/ui/Select';
import { useSiteConfig } from '../api/site';

export default function AdminUsers() {
  const [filters, setFilters] = useState({ q: '', role: '', status: '', kyc_status: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState(null);
  const list = useLoad(() => listUsers({ ...applied, page, page_size: 25 }), [applied, page]);
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Users</h2>
          <p className="adm-muted">Search by name, email or phone. Suspending signs the user out everywhere at once.</p>
        </div>
      </div>

      <form className="adm-filters" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); }}>
        <div className="adm-search grow"><Search size={15} />
          <input value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder="Name, email, phone or Buyer ID (SLX-000123)" /></div>
        <Select value={filters.role} onChange={(e) => set('role', e.target.value)}>
          <option value="">All roles</option><option value="bidder">Bidders</option><option value="seller">Sellers</option><option value="admin">Admins</option>
        </Select>
        <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </Select>
        <Select value={filters.kyc_status} onChange={(e) => set('kyc_status', e.target.value)}>
          <option value="">Any KYC</option><option value="pending">KYC pending</option><option value="verified">KYC verified</option><option value="rejected">KYC rejected</option>
        </Select>
        <button type="submit" className="adm-btn primary">Search</button>
      </form>

      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No users match.</Empty> : (
        <AdmTable>
            <thead><tr><th>Buyer ID</th><th>User</th><th>Phone</th><th>Role</th><th>KYC</th><th>Account</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setOpenId(u.id)}>
                  <td className="mono"><strong>{u.buyer_id}</strong></td>
                  <td><strong>{u.name}</strong><div className="adm-muted small">{u.email}{!u.is_email_verified && ' · email not verified'}</div></td>
                  <td>{u.mobile || '—'}</td>
                  <td><Badge value={u.role} /></td>
                  <td><Badge value={u.kyc_status} /></td>
                  <td><Badge value={u.is_active ? 'active' : 'suspended'} /></td>
                  <td>{dateTime(u.created_at)}</td>
                  <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />

      {openId && <UserDetail id={openId} onClose={() => setOpenId(null)} onChanged={(msg) => { setNotice(msg); list.reload(); }} />}
    </div>
  );
}

function UserDetail({ id, onClose, onChanged }) {
  const { data, error, loading, reload } = useLoad(() => getUser(id), [id]);
  const site = useSiteConfig();
  const [dialog, setDialog] = useState(null);

  if (!data) return <Modal title="User" onClose={onClose}>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;

  const done = (msg) => { reload(); onChanged(msg); };
  const otherRole = data.role === 'bidder' ? 'seller' : 'bidder';

  return (
    <Modal title={data.name} onClose={onClose}>
      <div className="adm-detail">
        <dl className="adm-dl">
          <dt>Email</dt><dd>{data.email}</dd>
          <dt>Phone</dt><dd>{data.mobile || '—'}</dd>
          <dt>Organization</dt><dd>{data.organization || '—'}</dd>
          <dt>Role</dt><dd><Badge value={data.role} /></dd>
          <dt>KYC</dt><dd><Badge value={data.kyc_status} /></dd>
          <dt>Account</dt><dd><Badge value={data.is_active ? 'active' : 'suspended'} /></dd>
          <dt>Signed in on</dt><dd>{data.active_session_count} device(s)</dd>
          <dt>Joined</dt><dd>{dateTime(data.created_at)}</dd>
          {!data.is_active && <><dt>Suspended</dt><dd>{dateTime(data.suspended_at)} · “{data.suspension_reason}”</dd></>}
          <dt>Unpaid wins</dt><dd>{data.payment_defaults}</dd>
          {data.bidding_blocked_until && <><dt>Bidding blocked</dt><dd>{new Date(data.bidding_blocked_until).getFullYear() > 9000 ? 'Permanently' : `Until ${dateTime(data.bidding_blocked_until)}`}</dd></>}
        </dl>

        {data.role !== 'admin' && (
          <div className="adm-actions-row left">
            {data.is_active ? (
              <button type="button" className="adm-btn danger" onClick={() => setDialog({
                title: `Suspend ${data.name}`, confirmLabel: 'Suspend', danger: true,
                description: 'They are signed out everywhere and cannot sign in or bid until reactivated.',
                onConfirm: async ({ reason }) => { await suspendUser(id, reason); done(`${data.name} suspended.`); },
              })}><UserX size={15} /> Suspend</button>
            ) : (
              <button type="button" className="adm-btn primary" onClick={() => setDialog({
                title: `Reactivate ${data.name}`, confirmLabel: 'Reactivate', reasonRequired: false,
                onConfirm: async ({ reason }) => { await reactivateUser(id, reason); done(`${data.name} reactivated.`); },
              })}><UserCheck size={15} /> Reactivate</button>
            )}
            {data.bidding_blocked_until && (
              <button type="button" className="adm-btn" onClick={() => setDialog({
                title: 'Lift bidding block', confirmLabel: 'Lift block',
                description: 'The user can bid again. The unpaid-win count stays on record.',
                onConfirm: async ({ reason }) => { await unblockBidding(id, reason); done(`Bidding block lifted for ${data.name}.`); },
              })}><ShieldOff size={15} /> Lift bidding block</button>
            )}
            {(site?.seller_accounts || data.role === 'seller') && <button type="button" className="adm-btn" onClick={() => setDialog({
              title: `Change role to ${otherRole}`, confirmLabel: `Make ${otherRole}`,
              description: `They are signed out so the new role applies at their next sign-in. Administrators can only be created on the server.`,
              onConfirm: async ({ reason }) => { await changeUserRole(id, otherRole, reason); done(`${data.name} is now a ${otherRole}.`); },
            })}><RefreshCcw size={15} /> Make {otherRole}</button>}
          </div>
        )}
      </div>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
