import React, { useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { CONTACT_STATUS, adminGetContactMessage, adminListContactMessages, adminUpdateContactMessage } from '../api/contact';
import { AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, dateTime, pickFilter, useLoad } from './ui';
import Select from '../components/ui/Select';

const TONE = { new: 'pending', in_progress: 'upcoming', closed: 'draft' };
const waLink = (n) => `https://wa.me/${n.replace(/[^0-9]/g, '')}`;

/** Messages sent from the public Contact page. Reply by email / phone / WhatsApp, then mark the status. */
const FILTERS = [{ value: 'new' }, { value: 'in_progress' }, { value: 'closed' }, { value: '' }];

export default function AdminMessages({ deepLink = {}, onDeepLinkClose }) {
  const [status, setStatus] = useState(pickFilter(deepLink.status, FILTERS, 'new'));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const linked = useLoad(() => (deepLink.id ? adminGetContactMessage(deepLink.id) : Promise.resolve(null)), [deepLink.id]);
  const [linkDone, setLinkDone] = useState(false);
  const shown = open || (!linkDone && linked.data);
  const closeDetail = () => { setOpen(null); setLinkDone(true); if (deepLink.id) onDeepLinkClose?.(); };
  const [notice, setNotice] = useState(null);
  const list = useLoad(() => adminListContactMessages({ status, page, page_size: 25 }), [status, page]);

  return (
    <div className="adm-section">
      <div className="adm-section-head">
        <div>
          <h2>Contact messages</h2>
          <p className="adm-muted">Enquiries from the Contact page. Reply by email, phone or WhatsApp, then update the status.</p>
        </div>
      </div>
      <div className="adm-tabs">
        {[['new', 'New'], ['in_progress', 'In progress'], ['closed', 'Closed'], ['', 'All']].map(([v, l]) => (
          <button key={l} type="button" className={status === v ? 'active' : ''} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
        ))}
      </div>
      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error} onRetry={list.reload} />
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>No messages here.</Empty> : (
        <AdmTable>
            <thead><tr><th>Ref</th><th>From</th><th>Subject</th><th>Message</th><th>Status</th><th>Received</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setOpen(m)}>
                  <td className="mono"><strong>{m.number}</strong></td>
                  <td>{m.name}<div className="adm-muted small">{m.email}</div></td>
                  <td>{m.subject}</td>
                  <td className="adm-muted wrap">{m.message.length > 70 ? `${m.message.slice(0, 70)}…` : m.message}</td>
                  <td><Badge value={TONE[m.status]} label={CONTACT_STATUS[m.status]?.label} /></td>
                  <td>{dateTime(m.created_at)}</td>
                  <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />
      {shown && <MessageDetail message={shown} onClose={closeDetail} onSaved={(msg) => { closeDetail(); setNotice(msg); list.reload(); }} />}
    </div>
  );
}

function MessageDetail({ message: m, onClose, onSaved }) {
  const [form, setForm] = useState({ status: m.status, admin_note: m.admin_note || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    const body = {};
    if (form.status !== m.status) body.status = form.status;
    if (form.admin_note.trim() !== (m.admin_note || '')) body.admin_note = form.admin_note.trim();
    if (Object.keys(body).length === 0) { setError('Nothing changed.'); return; }
    setBusy(true);
    setError(null);
    try { await adminUpdateContactMessage(m.id, body); onSaved(`${m.number} updated.`); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  const replySubject = encodeURIComponent(`Re: ${m.subject} (${m.number})`);
  return (
    <Modal title={`Message ${m.number}`} onClose={onClose}>
      <div className="adm-detail">
        <dl className="adm-dl">
          <dt>From</dt><dd>{m.name}<br /><span className="adm-muted small">{m.email} · {m.mobile}</span></dd>
          <dt>Subject</dt><dd>{m.subject}</dd>
          <dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{m.message}</dd>
          <dt>Received</dt><dd>{dateTime(m.created_at)}</dd>
        </dl>
        <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
          <a className="adm-btn small" href={`mailto:${m.email}?subject=${replySubject}`}><Mail size={14} /> Email</a>
          <a className="adm-btn small" href={`tel:${m.mobile.replace(/[^0-9+]/g, '')}`}><Phone size={14} /> Call</a>
          <a className="adm-btn small" href={waLink(m.mobile)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>
        </div>
        <form className="adm-form" onSubmit={save}>
          <label className="adm-field"><span>Status</span>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(CONTACT_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </Select>
          </label>
          <label className="adm-field"><span>Internal note (not sent to the customer)</span>
            <textarea rows={3} maxLength={1000} value={form.admin_note} onChange={(e) => setForm({ ...form, admin_note: e.target.value })}
              placeholder="e.g. Called back on 24 Oct, sent payment details." />
          </label>
          <ErrorBox message={error} />
          <div className="adm-actions-row">
            <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="adm-btn primary" disabled={busy}>Save</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
