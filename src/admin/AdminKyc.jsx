import React, { useState } from 'react';
import { CheckCircle2, Download, FileText, RotateCcw, XCircle } from 'lucide-react';
import { decideKyc, getKyc, listKyc } from '../api/admin';
import { DOCUMENT_LABELS, documentUrl } from '../api/kyc';
import { ActionDialog, AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, dateTime, pickFilter, useLoad } from './ui';

const TYPE_LABEL = DOCUMENT_LABELS;
const FILTERS = [
  { value: 'submitted', label: 'Waiting for review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Drafts' },
  { value: '', label: 'All' },
];

export default function AdminKyc({ deepLink = {}, onDeepLinkClose }) {
  const [status, setStatus] = useState(pickFilter(deepLink.status, FILTERS, 'submitted'));
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(deepLink.id || null);
  const closeDetail = () => { setOpenId(null); if (deepLink.id) onDeepLinkClose?.(); };
  const [notice, setNotice] = useState(null);
  const list = useLoad(() => listKyc({ status, page, page_size: 25 }), [status, page]);

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>KYC verification</h2>
          <p className="adm-muted">Open a submission, check every document against the account, then decide. Every decision needs a reason and is kept permanently.</p>
        </div>
      </div>

      <div className="adm-tabs">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" className={status === f.value ? 'active' : ''} onClick={() => { setStatus(f.value); setPage(1); }}>
            {f.label}
          </button>
        ))}
      </div>

      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}

      {list.data && (list.data.items.length === 0 ? (
        <Empty>No submissions here.</Empty>
      ) : (
        <AdmTable>
            <thead>
              <tr><th>Applicant</th><th>Role</th><th>Status</th><th>Submitted</th><th>Account KYC</th><th /></tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                  <td><strong>{s.user.name}</strong><div className="adm-muted small">{s.user.email}</div></td>
                  <td><Badge value={s.user.role} /></td>
                  <td><Badge value={s.status} /></td>
                  <td>{dateTime(s.submitted_at)}</td>
                  <td><Badge value={s.user.kyc_status} /></td>
                  <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />

      {openId && (
        <KycDetail id={openId} onClose={closeDetail}
          onDecided={(msg) => { setNotice(msg); closeDetail(); list.reload(); }} />
      )}
    </div>
  );
}

function KycDetail({ id, onClose, onDecided }) {
  const { data, error, loading, reload } = useLoad(() => getKyc(id), [id]);
  const [dialog, setDialog] = useState(null);

  const decide = (decision) => {
    const config = {
      approve: { title: 'Approve KYC', confirmLabel: 'Approve', initial: { reason: 'Documents verified against the account details' },
        description: 'The user will be able to bid immediately.' },
      request_changes: { title: 'Request changes', confirmLabel: 'Send back to the user',
        description: 'The user sees your reason and can upload corrected documents.', reasonLabel: 'What should the user fix?' },
      reject: { title: 'Reject KYC', confirmLabel: 'Reject', danger: true,
        description: 'The user cannot bid. They may start a new verification later.' },
    }[decision];
    setDialog({ ...config, onConfirm: async ({ reason }) => {
      await decideKyc(id, decision, reason);
      onDecided(`KYC ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'sent back for changes'} for ${data.user.name}.`);
    } });
  };

  return (
    <Modal title="KYC submission" onClose={onClose} wide>
      {!data && loading && <Spinner />}
      <ErrorBox message={error} onRetry={reload} />
      {data && (
        <div className="adm-detail">
          <div className="adm-grid-2">
            <div className="adm-card">
              <h4>Applicant</h4>
              <dl className="adm-dl">
                <dt>Name</dt><dd>{data.user.name}</dd>
                <dt>Email</dt><dd>{data.user.email}</dd>
                <dt>Role</dt><dd><Badge value={data.user.role} /></dd>
                <dt>Account</dt><dd><Badge value={data.user.is_active ? 'active' : 'suspended'} /></dd>
                <dt>Account KYC</dt><dd><Badge value={data.user.kyc_status} /></dd>
              </dl>
            </div>
            <div className="adm-card">
              <h4>Submission</h4>
              <dl className="adm-dl">
                <dt>Status</dt><dd><Badge value={data.status} /></dd>
                <dt>Started</dt><dd>{dateTime(data.created_at)}</dd>
                <dt>Submitted</dt><dd>{dateTime(data.submitted_at)}</dd>
                <dt>Aadhaar no.</dt><dd className="mono">{data.aadhaar_masked || '—'}
                  {data.aadhaar_used_by_other_account && <div className="adm-text-amber small">Same Aadhaar is on another account</div>}</dd>
                <dt>Last decision</dt><dd>{dateTime(data.decided_at)}</dd>
              </dl>
            </div>
          </div>

          <div className="adm-card">
            <h4>Documents ({data.documents.filter((d) => !d.withdrawn_at).length} active)</h4>
            {data.documents.length === 0 ? <p className="adm-muted">No documents uploaded.</p> : (
              <ul className="adm-doc-list">
                {data.documents.map((d) => (
                  <li key={d.id} className={d.withdrawn_at ? 'withdrawn' : ''}>
                    <FileText size={18} />
                    <div>
                      <strong>{TYPE_LABEL[d.document_type] || d.document_type}</strong>
                      <span className="adm-muted small">
                        {d.content_type.replace('application/', '').replace('image/', '').toUpperCase()} · {Math.max(1, Math.round(d.size_bytes / 1024))} KB · {dateTime(d.uploaded_at)}
                        {d.withdrawn_at && ' · withdrawn by user'}
                      </span>
                    </div>
                    <a className="adm-btn small" href={documentUrl(d.id)}><Download size={14} /> Download</a>
                  </li>
                ))}
              </ul>
            )}
            <p className="adm-muted small">Each download is recorded in the audit log.</p>
          </div>

          {data.decisions.length > 0 && (
            <div className="adm-card">
              <h4>Decision history</h4>
              <ul className="adm-timeline">
                {data.decisions.map((d) => (
                  <li key={d.id}><Badge value={d.decision} /> <span>{d.reason}</span> <span className="adm-muted small">{dateTime(d.created_at)}</span></li>
                ))}
              </ul>
            </div>
          )}

          {data.status === 'submitted' ? (
            <div className="adm-actions-row">
              <button type="button" className="adm-btn danger" onClick={() => decide('reject')}><XCircle size={15} /> Reject</button>
              <button type="button" className="adm-btn" onClick={() => decide('request_changes')}><RotateCcw size={15} /> Request changes</button>
              <button type="button" className="adm-btn primary" onClick={() => decide('approve')}><CheckCircle2 size={15} /> Approve</button>
            </div>
          ) : (
            <p className="adm-muted">This submission is not waiting for a decision.</p>
          )}
        </div>
      )}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
