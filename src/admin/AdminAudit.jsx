import React, { useState } from 'react';
import { listAudit } from '../api/admin';
import { AdmTable, Empty, ErrorBox, Pager, Spinner, dateTime, useLoad } from './ui';
import Select from '../components/ui/Select';

const ACTIONS = [
  '', 'user.suspend', 'user.reactivate', 'user.role_change', 'kyc.approve', 'kyc.reject', 'kyc.request_changes',
  'kyc.document_view', 'vehicle.approve', 'vehicle.reject', 'vehicle.request_changes', 'vehicle.admin_edit',
  'auction.create', 'auction.update', 'auction.pause', 'auction.resume', 'auction.extend', 'auction.cancel',
  'auction.close', 'auction.auto_extend',
];

/** Read-only: the permanent record of every sensitive action (it cannot be edited or deleted). */
export default function AdminAudit() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(() => listAudit({ action, page, page_size: 50 }), [action, page]);

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Audit log</h2>
          <p className="adm-muted">Who did what, when and why. Entries can never be changed or deleted.</p>
        </div>
        <Select className="adm-select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
        </Select>
      </div>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No entries.</Empty> : (
        <AdmTable className="compact">
            <thead><tr><th>When</th><th>Action</th><th>By</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.created_at)}</td>
                  <td><strong>{e.action}</strong></td>
                  <td>{e.actor_role}</td>
                  <td className="mono small">{e.target_type} {e.target_id?.slice(0, 8)}</td>
                  <td className="small wrap">{Object.entries(e.details || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
    </div>
  );
}
