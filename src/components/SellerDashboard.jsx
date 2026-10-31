import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Car, ImagePlus, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useSiteConfig } from '../api/site';
import {
  createVehicle, deletePhoto, getMyVehicle, listMyVehicles, ownPhotoUrl, submitVehicle, updateVehicle, vehicleTitle,
} from '../api/vehicles';
import VehicleForm from './VehicleForm';
import { sourcePhotoProblem, uploadVehiclePhoto } from '../api/photoPrep';
import { AdmTable, Badge, ErrorBox, Modal, Notice, Spinner, dateTime, useLoad } from '../admin/ui';
import '../admin/Admin.css';

const STATUS_HELP = {
  draft: 'Draft: add photos, then submit it for review.',
  submitted: 'Waiting for our team to review it.',
  changes_requested: 'Our team asked for changes. See the note, fix it and submit again.',
  approved: 'Approved: visible on the website. Our team schedules the auction.',
  rejected: 'Not accepted. See the note below.',
};

/** A seller's own vehicles: add, add photos, submit for review. Real data only. */
export default function SellerDashboard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useLoad(() => listMyVehicles(), []);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (params.get('new') === '1') setParams({}, { replace: true });   // one-time: opened from "List your vehicle"
  }, [params, setParams]);

  return (
    <div className="adm-page">
      <div className="adm-shell single">
        <main className="adm-main">
          <div className="adm-section">
            <div className="adm-section-head">
              <div>
                <h2>My vehicles</h2>
                <p className="adm-muted">Hello {user?.name}. Add a vehicle with its details and photos; our team reviews it before it goes live.</p>
              </div>
              <button type="button" className="adm-btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Add vehicle</button>
            </div>

            <Notice onClose={() => setNotice(null)}>{notice}</Notice>
            <ErrorBox message={list.error} onRetry={list.reload} />
            {!list.data && list.loading && <Spinner />}
            {list.data && (list.data.items.length === 0 ? (
              <div className="adm-empty">
                <Car size={34} /><p>You have not added a vehicle yet.</p>
                <button type="button" className="adm-btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Add your first vehicle</button>
              </div>
            ) : (
              <AdmTable>
                  <thead><tr><th>Vehicle</th><th>Registration</th><th>Photos</th><th>Status</th><th>Added</th><th /></tr></thead>
                  <tbody>
                    {list.data.items.map((v) => (
                      <tr key={v.id} className="clickable" onClick={() => setOpenId(v.id)}>
                        <td><strong>{vehicleTitle(v)}</strong><div className="adm-muted small">{v.location}</div></td>
                        <td className="mono">{v.registration_number}</td>
                        <td>{v.photos.length}</td>
                        <td><Badge value={v.status} label={v.status === 'submitted' ? 'in review' : undefined} /></td>
                        <td>{dateTime(v.created_at)}</td>
                        <td className="right"><button type="button" className="adm-btn small">Open</button></td>
                      </tr>
                    ))}
                  </tbody>
                </AdmTable>
            ))}
          </div>
        </main>
      </div>

      {creating && (
        <Modal title="Add a vehicle" onClose={() => setCreating(false)} wide>
          <p className="adm-muted">Step 1 of 2: vehicle details (all required). Next you add photos and submit for review.</p>
          <VehicleForm auctionOnly saveLabel="Save and add photos" onCancel={() => setCreating(false)}
            onSave={async (body) => {
              const created = await createVehicle(body);
              setCreating(false);
              list.reload();
              setOpenId(created.id);
            }} />
        </Modal>
      )}
      {openId && (
        <SellerVehicle id={openId} onClose={() => { setOpenId(null); list.reload(); }}
          onSubmitted={() => { setNotice('Sent for review. We will let you know when it is approved.'); list.reload(); }} />
      )}
    </div>
  );
}

function SellerVehicle({ id, onClose, onSubmitted }) {
  const { data, error, loading, reload } = useLoad(() => getMyVehicle(id), [id]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [editing, setEditing] = useState(false);
  const fileInput = useRef(null);

  if (!data) return <Modal title="Vehicle" onClose={onClose} wide>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;

  const editable = ['draft', 'changes_requested'].includes(data.status);

  const addPhotos = async (files) => {
    setProblem(null);
    const issues = files.map(sourcePhotoProblem).filter(Boolean);
    if (issues.length) { setProblem(issues.join(' ')); return; }
    setBusy(true);
    try { for (const f of files) await uploadVehiclePhoto(id, f); } catch (err) { setProblem(err.message); }
    setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
    reload();
  };

  const submit = async () => {
    setProblem(null);
    setBusy(true);
    try { await submitVehicle(id); onSubmitted(); reload(); } catch (err) { setProblem(err.message); }
    setBusy(false);
  };

  return (
    <Modal title={`${vehicleTitle(data)} · ${data.registration_number}`} onClose={onClose} wide>
      <div className="adm-detail">
        <div className="adm-inline"><Badge value={data.status} /> <span className="adm-muted">{STATUS_HELP[data.status]}</span></div>
        {data.review_reason && <div className="adm-alert adm-alert-warning"><span>Note from our team: {data.review_reason}</span></div>}

        <div className="adm-card">
          <div className="adm-card-head">
            <h4>Photos ({data.photos.length})</h4>
            {editable && (
              <label className={`adm-btn small${busy ? ' disabled' : ''}`}>
                {busy ? <Loader2 size={14} className="adm-spin" /> : <ImagePlus size={14} />} Add photos
                <input ref={fileInput} type="file" accept="image/jpeg,image/png" multiple hidden disabled={busy}
                  onChange={(e) => addPhotos(Array.from(e.target.files || []))} />
              </label>
            )}
          </div>
          <p className="adm-muted small">JPEG or PNG, up to 5 MB each. The first photo is the cover. Clear photos of all sides and the damage help it sell.</p>
          {data.photos.length > 0 && (
            <div className="adm-photos">
              {data.photos.map((p, i) => (
                <figure key={p.id}>
                  <img src={ownPhotoUrl(data.id, p.id)} alt={`Photo ${i + 1}`} loading="lazy" />
                  {i === 0 && <figcaption>Cover</figcaption>}
                  {editable && (
                    <button type="button" className="adm-photo-del" aria-label="Delete photo"
                      onClick={async () => { if (window.confirm('Delete this photo?')) { await deletePhoto(id, p.id); reload(); } }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="adm-card">
          <div className="adm-card-head">
            <h4>Details</h4>
            {editable && !editing && <button type="button" className="adm-btn small" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          <VehicleForm auctionOnly key={editing ? 'edit' : 'view'} initial={data} disabled={!editing} saveLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSave={async (body) => {
              const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== data[k]));
              if (Object.keys(changed).length) await updateVehicle(id, changed);
              setEditing(false);
              reload();
            }} />
        </div>

        <ErrorBox message={problem} />
        {editable && (
          <div className="adm-actions-row">
            <button type="button" className="adm-btn primary" disabled={busy || data.photos.length === 0} onClick={submit}
              title={data.photos.length === 0 ? 'Add at least one photo first' : ''}>
              <Send size={15} /> Submit for review
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** "/sell": the entry point from "List your vehicle". */
export function SellPage() {
  const { user, status } = useAuth();
  const site = useSiteConfig();
  if (status === 'loading' || !site) return <div className="adm-page"><Spinner /></div>;
  if (!site.seller_accounts && user?.role !== 'admin') return <Navigate to="/" replace />;   // only admins add vehicles
  return (
    <div className="adm-page">
      <div className="adm-shell single">
        <main className="adm-main">
          <div className="adm-section">
            <div className="adm-section-head"><div>
              <h2>Sell your vehicle on Salvex</h2>
              <p className="adm-muted">Add the vehicle details and photos. Our team checks every vehicle and then puts it up for auction.</p>
            </div></div>
            <div className="adm-card">
              {!user && (
                <>
                  <p>To list a vehicle you need a <strong>seller account</strong>.</p>
                  <div className="adm-actions-row left">
                    <Link to="/register" state={{ role: 'seller' }} className="adm-btn primary">Create a seller account</Link>
                    <Link to="/login" state={{ from: { pathname: '/seller/dashboard' } }} className="adm-btn">I already have one: sign in</Link>
                  </div>
                </>
              )}
              {user && (user.role === 'seller' || user.role === 'admin') && (
                <>
                  <p>You are signed in as a {user.role}.</p>
                  <div className="adm-actions-row left">
                    <Link to={user.role === 'admin' ? '/admin?tab=vehicles' : '/seller/dashboard?new=1'} className="adm-btn primary"><Plus size={15} /> Add a vehicle</Link>
                  </div>
                </>
              )}
              {user && user.role === 'bidder' && (
                <p>Your account is a <strong>bidder</strong> account. To sell vehicles, please contact our support team to switch your account to a seller account.</p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
