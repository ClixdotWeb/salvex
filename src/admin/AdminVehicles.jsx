import React, { useState } from 'react';
import { Check, CheckCircle2, FileSpreadsheet, Gavel, Loader2, Plus, RotateCcw, Search, Send, XCircle } from 'lucide-react';
import { bulkPublish, getVehicle, listVehicles, reviewVehicle } from '../api/admin';
import AdminBulkUpload from './AdminBulkUpload';
import BulkAuctions from './BulkAuctions';
import {
  submitVehicle, updateVehicle, vehicleTitle,
} from '../api/vehicles';
import VehicleForm from '../components/VehicleForm';
import PhotoManager from './PhotoManager';
import { PhotoStep } from './PhotoStep';
import { createOrResumeDraft } from './draftResume';
import { ActionDialog, AdmTable, Badge, Empty, ErrorBox, Modal, Notice, Pager, Spinner, VehicleCell, dateTime, useLoad } from './ui';
import { categoryLabel } from '../api/auctions';
import { markReadyToLiftSold, reopenReadyToLift } from '../api/readyToLift';

// The two vehicle screens: Ready to Lift (its own section) and the vehicles for auction (under Auctions).
const SCREENS = {
  ready_to_lift: {
    title: 'Ready to Lift',
    help: 'Vehicles sold without an auction and without a price on the website. Buyers tap "I\'m interested" and our team calls them.',
    filters: [
      { key: 'available', label: 'Available', params: { status: 'approved', sold: false } },
      { key: 'sold', label: 'Sold', params: { status: 'approved', sold: true } },
      { key: 'draft', label: 'Drafts', params: { status: 'draft' } },
      { key: 'all', label: 'All', params: {} },
    ],
  },
  auction: {
    title: 'Waiting for an auction',
    help: 'Vehicles without an auction yet.',
    filters: [
      { key: 'ready', label: 'Ready to start', params: { ready_for_auction: true } },
      { key: 'draft', label: 'Need photos', params: { status: 'draft' } },
    ],
  },
};

// embedded: shown inside Auctions > Waiting (no own heading; "Start auction" on each ready vehicle).
export default function AdminVehicles({ listing = 'auction', onAuction, deepLink = {}, onDeepLinkClose, embedded, onChanged, refreshKey }) {
  const screen = SCREENS[listing];
  const rtl = listing === 'ready_to_lift';
  const [filter, setFilter] = useState(screen.filters.find((f) => f.key === deepLink.status)?.key || screen.filters[0].key);
  const current = screen.filters.find((f) => f.key === filter) || screen.filters[0];
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(deepLink.id || null);
  const closeDetail = () => { setOpenId(null); if (deepLink.id) onDeepLinkClose?.(); };
  const [creating, setCreating] = useState(listing === 'ready_to_lift' && deepLink.status === 'add');   // from the dashboard
  const [bulk, setBulk] = useState(null);                // 'upload' | 'auctions'
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const list = useLoad(() => listVehicles({ ...current.params, listing_type: listing, q: search, page, page_size: 25 }),
    [filter, listing, search, page, refreshKey]);
  const status = current.params.status;

  const reloadAll = () => { list.reload(); onChanged?.(); };

  return (
    <div className={embedded ? 'adm-embedded' : 'adm-section'}>
      {!embedded && <div className="adm-section-head">
        <div>
          <h2>{screen.title}</h2>
          <p className="adm-muted">{screen.help}</p>
        </div>
        <div className="adm-actions-row adm-head-actions">
          <button type="button" className="adm-btn" onClick={() => setBulk('upload')}><FileSpreadsheet size={15} /> Bulk upload</button>
          {rtl
            ? <button type="button" className="adm-btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Add vehicle</button>
            : <button type="button" className="adm-btn primary" onClick={() => setBulk('auctions')}><Gavel size={15} /> Create auctions</button>}
        </div>
      </div>}

      <div className="adm-toolbar">
        <div className="adm-tabs">
          {screen.filters.map((f) => (
            <button key={f.key} type="button" className={filter === f.key ? 'active' : ''} onClick={() => { setFilter(f.key); setPage(1); }}>{f.label}</button>
          ))}
        </div>
        <form className="adm-search" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}>
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Registration, make or model" />
        </form>
        {embedded && filter === 'ready' && list.data?.items.length > 1 && (
          <button type="button" className="adm-btn" onClick={() => setBulk('auctions')}><Gavel size={15} /> Start several together</button>
        )}
      </div>

      <Notice onClose={() => setNotice(null)}>{notice}</Notice>
      <ErrorBox message={list.error || actionError} onRetry={list.error ? list.reload : undefined} />
      {status === 'draft' && list.data?.items.some((v) => v.cover_photo_id) && (
        <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="adm-btn small" disabled={publishing} onClick={async () => {
            setPublishing(true);
            setActionError(null);
            try {
              const items = list.data.items.filter((v) => v.cover_photo_id).map((v) => ({ vehicle_id: v.id }));
              const res = await bulkPublish({ items });
              setNotice(`${res.published} vehicle(s) published.${res.failed ? ` ${res.failed} could not be published.` : ''}`);
              list.reload();
            } catch (err) { setActionError(err.message); } finally { setPublishing(false); }
          }}>{publishing ? <Loader2 size={14} className="adm-spin" /> : <Send size={14} />} Publish drafts with photos (this page)</button>
        </div>
      )}
      {!list.data && list.loading && <Spinner />}
      {list.data && (list.data.items.length === 0 ? <Empty>{embedded && filter === 'ready' ? 'No vehicles waiting. Add one with New auction or Bulk upload.' : 'No vehicles here.'}</Empty> : (
        <AdmTable>
            <thead><tr><th>Vehicle</th><th>{rtl ? 'Ready to Lift' : 'Category'}</th><th>Location</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => setOpenId(v.id)}>
                  <td className="adm-cell-main">
                    <VehicleCell vehicleId={v.id} photoId={v.cover_photo_id}
                      title={`${v.manufacturing_year} ${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ''}`} sub={v.registration_number} />
                  </td>
                  <td>{v.listing_type === 'ready_to_lift'
                    ? <Badge value={v.sold_at ? 'ended' : 'live'} label={v.sold_at ? 'Ready to Lift · sold' : 'Ready to Lift'} />
                    : categoryLabel(v.category)}</td>
                  <td>{v.location}</td>
                  <td><Badge value={v.status} /></td>
                  <td>{dateTime(v.created_at)}</td>
                  <td className="right">
                    {embedded && v.status === 'approved'
                      ? <button type="button" className="adm-btn small primary" onClick={(e) => { e.stopPropagation(); onAuction?.(v); }}><Gavel size={13} /> Start auction</button>
                      : <button type="button" className="adm-btn small">Open</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdmTable>
      ))}
      <Pager page={list.data} onPage={setPage} />

      {creating && (
        <AddVehicleWizard listing={listing}
          onClose={(draft) => {
            setCreating(false);
            if (draft) setNotice(`${draft.registration_number} is saved as a draft (Drafts tab). Add its photos and publish it from there, or add it again: you continue where you stopped.`);
            reloadAll();
          }}
          onPublished={(v) => { setCreating(false); setNotice(`${v.registration_number} is published on the website.`); list.reload(); }}
          onAuction={(v) => { setCreating(false); onAuction(v); }} />
      )}

      {bulk === 'upload' && <AdminBulkUpload listing={listing} onClose={() => { setBulk(null); reloadAll(); }} onFinished={reloadAll} />}
      {bulk === 'auctions' && <BulkAuctions onClose={() => { setBulk(null); reloadAll(); }} onDone={(msg) => { setNotice(msg); reloadAll(); }} />}

      {openId && (
        <VehicleDetail id={openId} onClose={() => { closeDetail(); reloadAll(); }}
          onDone={(msg) => { setNotice(msg); reloadAll(); }}
          onAuction={(v) => { setOpenId(null); onAuction(v); }} />
      )}
    </div>
  );
}

const ADD_STEPS = ['Vehicle details', 'Photos'];

/** Add vehicle in one flow: 1) details, 2) photos and publish. An auction vehicle can go straight to an auction. */
function AddVehicleWizard({ listing, onClose, onPublished, onAuction }) {
  const [step, setStep] = useState(1);
  const [vehicle, setVehicle] = useState(null);
  const [published, setPublished] = useState(null);
  const [resumed, setResumed] = useState(false);
  const close = () => onClose(published ? null : vehicle);      // an unfinished vehicle stays as a draft

  return (
    <Modal title={listing === 'ready_to_lift' ? 'Add Ready to Lift vehicle' : 'Add vehicle'} onClose={close} wide>
      <ol className="adm-steps">
        {ADD_STEPS.map((label, i) => {
          const done = published || step > i + 1;
          return (
            <li key={label} className={!published && step === i + 1 ? 'current' : done ? 'done' : ''}>
              <span className="adm-step-num">{done ? <Check size={13} /> : i + 1}</span>
              <span className="adm-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <VehicleForm initial={vehicle} listing={listing} saveLabel="Continue to photos" onCancel={close}
          onSave={async (body) => {
            if (vehicle) { setVehicle(await updateVehicle(vehicle.id, body)); setStep(2); return; }
            const result = await createOrResumeDraft(body);
            setVehicle(result.vehicle);
            setResumed(result.resumed);
            setStep(2);
          }} />
      )}
      {resumed && step === 2 && (
        <p className="adm-alert adm-alert-info" role="status">
          You had started {vehicle.registration_number} earlier. Continuing that draft with these details; photos already added are kept.
        </p>
      )}

      {step === 2 && vehicle && !published && (
        <PhotoStep vehicleId={vehicle.id} onBack={() => setStep(1)} onLater={close} confirmLabel="Publish vehicle"
          onConfirmed={(approved) => (approved.listing_type === 'ready_to_lift' ? onPublished(approved) : setPublished(approved))} />
      )}
      {published && (
        <div className="adm-bulk-result">
          <h4><CheckCircle2 size={18} /> {published.registration_number} is published on the website</h4>
          <p className="adm-muted">Put it up for auction now, or later from Auctions &gt; Waiting.</p>
          <div className="adm-actions-row">
            <button type="button" className="adm-btn" onClick={() => onPublished(published)}>Later</button>
            <button type="button" className="adm-btn primary" onClick={() => onAuction(published)}><Gavel size={15} /> Put up for auction</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function VehicleDetail({ id, onClose, onDone, onAuction }) {
  const { data, error, loading, reload } = useLoad(() => getVehicle(id), [id]);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [actionError, setActionError] = useState(null);

  if (!data) {
    return <Modal title="Vehicle" onClose={onClose} wide>{loading ? <Spinner /> : <ErrorBox message={error} onRetry={reload} />}</Modal>;
  }

  const editable = data.status !== 'rejected' && !data.locked;      // locked = in an open auction, or sold
  const canPublish = ['draft', 'changes_requested'].includes(data.status);

  const review = (decision) => {
    const config = {
      approve: { title: 'Approve vehicle', confirmLabel: 'Approve and publish', reasonRequired: false,
        description: 'The vehicle appears on the website and can be put up for auction.' },
      request_changes: { title: 'Request changes', confirmLabel: 'Send back', reasonLabel: 'What should the seller fix?' },
      reject: { title: 'Reject vehicle', confirmLabel: 'Reject', danger: true },
    }[decision];
    setDialog({ ...config, onConfirm: async ({ reason }) => {
      await reviewVehicle(id, decision, reason || undefined);
      onDone(`Vehicle ${data.registration_number}: ${decision.replace('_', ' ')} done.`);
      reload();
    } });
  };

  // An admin's own stock (or a seller's draft the admin finished) is submitted and approved in one go.
  const publish = async () => {
    setActionError(null);
    try {
      await submitVehicle(id);
      await reviewVehicle(id, 'approve');
      onDone(`Vehicle ${data.registration_number} is approved and visible on the website.`);
      reload();
    } catch (err) {
      setActionError(err.message);
      reload();
    }
  };

  return (
    <Modal title={`${vehicleTitle(data)} · ${data.registration_number}`} onClose={onClose} wide>
      <div className="adm-detail">
        <div className="adm-inline">
          <Badge value={data.status} />
          <span className="adm-muted small">Added {dateTime(data.created_at)} · submitted {dateTime(data.submitted_at)} · reviewed {dateTime(data.reviewed_at)}</span>
        </div>
        {data.review_reason && <div className="adm-alert adm-alert-warning"><span>Last review note: {data.review_reason}</span></div>}

        <div className="adm-card">
          <div className="adm-card-head">
            <h4>Photos ({data.photos.length})</h4>
          </div>
          {data.locked && <p className="adm-muted small">This vehicle is in an auction or sold, so its photos and details cannot be changed.</p>}
          <PhotoManager vehicleId={data.id} photos={data.photos} editable={editable} keepOne={data.status === 'approved'} onChanged={reload} />
        </div>

        <div className="adm-card">
          <div className="adm-card-head">
            <h4>Details</h4>
            {editable && !editing && <button type="button" className="adm-btn small" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          <VehicleForm key={editing ? 'edit' : 'view'} initial={data} listing={data.listing_type} disabled={!editing} saveLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSave={async (body) => {
              const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== data[k]));
              if (Object.keys(changed).length) await updateVehicle(id, changed);
              setEditing(false);
              reload();
            }} />
        </div>

        <ErrorBox message={actionError} />
        <div className="adm-actions-row">
          {data.status === 'submitted' && (
            <>
              <button type="button" className="adm-btn danger" onClick={() => review('reject')}><XCircle size={15} /> Reject</button>
              <button type="button" className="adm-btn" onClick={() => review('request_changes')}><RotateCcw size={15} /> Request changes</button>
              <button type="button" className="adm-btn primary" onClick={() => review('approve')}><CheckCircle2 size={15} /> Approve</button>
            </>
          )}
          {canPublish && (
            <button type="button" className="adm-btn primary" disabled={data.photos.length === 0} onClick={publish}
              title={data.photos.length === 0 ? 'Add at least one photo first' : ''}>
              <CheckCircle2 size={15} /> Approve and publish
            </button>
          )}
          {data.status === 'approved' && data.listing_type !== 'ready_to_lift' && (
            <button type="button" className="adm-btn primary" onClick={() => onAuction(data)}><Gavel size={15} /> Put up for auction</button>
          )}
          {data.status === 'approved' && data.listing_type === 'ready_to_lift' && !data.sold_at && (
            <button type="button" className="adm-btn primary" onClick={() => setDialog({
              title: 'Mark as sold', confirmLabel: 'Mark sold', reasonRequired: false,
              description: 'The vehicle leaves the public Ready to Lift list. You can show it again later.',
              onConfirm: async ({ reason }) => { await markReadyToLiftSold(data.id, reason); onDone(`${data.registration_number} marked sold.`); reload(); },
            })}><CheckCircle2 size={15} /> Mark as sold</button>
          )}
          {data.status === 'approved' && data.listing_type === 'ready_to_lift' && data.sold_at && (
            <button type="button" className="adm-btn" onClick={() => setDialog({
              title: 'Show again on Ready to Lift', confirmLabel: 'Show again', reasonRequired: false,
              onConfirm: async ({ reason }) => { await reopenReadyToLift(data.id, reason); onDone(`${data.registration_number} is listed again.`); reload(); },
            })}><RotateCcw size={15} /> Show again</button>
          )}
        </div>
      </div>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
