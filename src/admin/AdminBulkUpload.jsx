import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FolderOpen, ImagePlus, Loader2, Upload } from 'lucide-react';
import { bulkCheck, bulkImport, bulkPublish, bulkTemplateUrl } from '../api/admin';
import { uploadVehiclePhoto } from '../api/photoPrep';
import { getVehicle } from '../api/admin';
import Select from '../components/ui/Select';
import PhotoManager from './PhotoManager';
import { AdmTable, Badge, ErrorBox, Modal, Spinner, dateTime, money, useLoad } from './ui';
import { MAX_PHOTOS_PER_VEHICLE, matchPhotos, regKey } from './photoMatch';

const PUBLISH_CHUNK = 50;
const CATEGORIES = { insurance: 'Insurance', bank_nbfc: 'Bank / NBFC', used_vehicle: 'Used vehicle' };
const PHOTO_WORKERS = 3;

/** Run `task` over `items` with a few at a time; returns the results in order. */
async function pool(items, workers, task) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, run));
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;          // never a formula in Excel
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function downloadProblems(rows) {
  const lines = [['Row', 'Registration number', 'Vehicle', 'Problems'], ...rows.map((r) => [r.row, r.registration_number, r.title, r.errors.join('; ')])];
  const blob = new Blob([`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'salvex-upload-problems.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Admin: add many vehicles from an Excel / CSV file, with their photos and (optionally) auctions.
 * Steps: choose file -> check (problems listed per row) -> choose photos folder -> import -> photos -> publish.
 */
export default function AdminBulkUpload({ onClose, onFinished, listing = 'auction' }) {
  const rtl = listing === 'ready_to_lift';
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('insurance');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [publish, setPublish] = useState(true);
  const [progress, setProgress] = useState(null);       // { stage, done, total }
  const [result, setResult] = useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const photoInput = useRef(null);
  const running = Boolean(progress) && !result;

  const valid = useMemo(() => (check ? check.rows.filter((r) => r.errors.length === 0) : []), [check]);
  const problems = useMemo(() => (check ? check.rows.filter((r) => r.errors.length > 0) : []), [check]);
  const matched = useMemo(() => matchPhotos(photos, valid), [photos, valid]);
  const photoCount = (reg) => matched.byReg.get(regKey(reg))?.length || 0;
  const withoutPhotos = valid.filter((r) => photoCount(r.registration_number) === 0).length;

  const choose = async (picked, cat = category) => {
    if (!picked) return;
    setFile(picked);
    setCheck(null);
    setResult(null);
    setError(null);
    setChecking(true);
    try { setCheck(await bulkCheck(picked, cat, listing)); } catch (err) { setError(err.message); } finally { setChecking(false); }
  };

  const run = async () => {
    setError(null);
    setProgress({ stage: 'Saving vehicles…', done: 0, total: valid.length });
    let imported;
    try {
      imported = await bulkImport(file, category, listing);
    } catch (err) {
      setError(err.message);
      setProgress(null);
      return;
    }
    const created = imported.created;
    // photos, a few at a time
    const uploads = created.flatMap((c) => (matched.byReg.get(regKey(c.registration_number)) || []).map((f) => ({ c, f })));
    const photoFailed = [];
    const photoOk = new Map();
    let done = 0;
    setProgress({ stage: 'Uploading photos', done, total: uploads.length });
    await pool(uploads, PHOTO_WORKERS, async ({ c, f }) => {
      try {
        await uploadVehiclePhoto(c.vehicle_id, f, { square: true });     // 1:1 from the centre
        photoOk.set(c.vehicle_id, (photoOk.get(c.vehicle_id) || 0) + 1);
      } catch (err) {
        photoFailed.push(`${f.name}: ${err.message}`);
      }
      done += 1;
      setProgress({ stage: 'Uploading photos', done, total: uploads.length });
    });
    // publish (submit + approve) and create the auctions from the file
    const results = [];
    const toPublish = publish ? created.filter((c) => photoOk.get(c.vehicle_id)) : [];
    for (let i = 0; i < toPublish.length; i += PUBLISH_CHUNK) {
      setProgress({ stage: 'Publishing', done: i, total: toPublish.length });
      const chunk = toPublish.slice(i, i + PUBLISH_CHUNK).map((c) => ({ vehicle_id: c.vehicle_id, ...(c.auction ? { auction: c.auction } : {}) }));
      try {
        const res = await bulkPublish({ items: chunk });
        results.push(...res.results);
      } catch (err) {
        results.push(...chunk.map((c) => ({ vehicle_id: c.vehicle_id, error: err.message, published: false, auction_id: null })));
      }
    }
    const regOf = new Map(created.map((c) => [c.vehicle_id, c.registration_number]));
    setResult({
      created: created.length,
      skipped: imported.skipped,
      photos: [...photoOk.values()].reduce((a, b) => a + b, 0),
      photoFailed,
      published: results.filter((r) => r.published || (r.status === 'approved' && !r.error)).length,
      auctions: results.filter((r) => r.auction_id).length,
      failed: results.filter((r) => r.error).map((r) => `${r.registration_number || regOf.get(r.vehicle_id)}: ${r.error}`),
      drafts: created.length - results.filter((r) => r.status === 'approved' && !r.error).length,
      draftRows: created.filter((c) => !results.some((r) => r.vehicle_id === c.vehicle_id && r.status === 'approved' && !r.error)),
    });
    setProgress({ stage: 'Done', done: 1, total: 1 });
    onFinished?.();
  };

  const shown = onlyProblems ? problems : check?.rows || [];

  return (
    <Modal title={rtl ? 'Bulk upload Ready to Lift vehicles' : 'Bulk upload vehicles'} onClose={() => { if (!running) onClose(); }} wide>
      <div className="adm-bulk">
        {!result && (
          <>
            <div className="adm-bulk-step">
              <span className="adm-bulk-num">1</span>
              <div>
                <h4>Fill the template</h4>
                <p className="adm-muted">{rtl
                  ? 'One vehicle per row. Every row is a Ready to Lift vehicle (no auction, no price): fill KM driven and Superdari, leave the auction columns empty.'
                  : 'One vehicle per row. Auction columns are optional: fill them to create the auction now, or leave them empty and create auctions later.'}</p>
                <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
                  <a className="adm-btn small" href={bulkTemplateUrl('xlsx')} download><Download size={14} /> Excel template</a>
                  <a className="adm-btn small" href={bulkTemplateUrl('csv')} download><Download size={14} /> CSV template</a>
                </div>
              </div>
            </div>

            <div className="adm-bulk-step">
              <span className="adm-bulk-num">2</span>
              <div>
                <h4>Choose the filled file</h4>
{!rtl && (
                <label className="adm-field adm-bulk-category">
                  <span>Auction category for rows without one</span>
                  <Select value={category} disabled={checking || running}
                    onChange={(e) => { setCategory(e.target.value); if (file) choose(file, e.target.value); }}>
                    {Object.entries(CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </label>
                )}
                <input ref={fileInput} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} aria-label="Vehicle file" />
                <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
                  <button type="button" className="adm-btn primary small" disabled={checking || running} onClick={() => fileInput.current?.click()}>
                    {checking ? <Loader2 size={14} className="adm-spin" /> : <FileSpreadsheet size={14} />} {file ? 'Choose another file' : 'Choose Excel / CSV file'}
                  </button>
                  {file && <span className="adm-muted small">{file.name}</span>}
                </div>
                {checking && <p className="adm-muted small">Checking every row…</p>}
              </div>
            </div>
            <ErrorBox message={error} />

            {check && (
              <>
                <div className="adm-bulk-summary">
                  <div className="ok"><CheckCircle2 size={16} /> <strong>{check.valid}</strong> ready</div>
                  <div className={check.invalid ? 'bad' : ''}><AlertTriangle size={16} /> <strong>{check.invalid}</strong> with problems</div>
                  <div><strong>{check.with_auction}</strong> with auction</div>
                  {problems.length > 0 && (
                    <>
                      <label className="adm-check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only problems</label>
                      <button type="button" className="adm-btn small" onClick={() => downloadProblems(problems)}><Download size={14} /> Problem list</button>
                    </>
                  )}
                </div>
                {problems.length > 0 && <p className="adm-muted small">Rows with problems are skipped. Fix them in Excel and upload the file again later (rows already added are then refused as duplicates).</p>}
                <div className="adm-bulk-table">
                  <AdmTable>
                    <thead><tr><th>Row</th><th>Vehicle</th><th>Listing</th>{!rtl && <th>Category</th>}<th>Auction</th><th>Photos</th><th>Check</th></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.row} className={r.errors.length ? 'adm-row-bad' : ''}>
                          <td>{r.row}</td>
                          <td><div className="adm-two-line"><strong>{r.title || '—'}</strong><span className="mono">{r.registration_number || '—'}</span></div></td>
                          <td>{r.listing_type === 'ready_to_lift' ? <Badge value="live" label="Ready to Lift" /> : 'Auction'}</td>
                          {!rtl && <td>{CATEGORIES[r.category] || '—'}</td>}
                          <td>{r.auction ? <div className="adm-two-line"><strong>{money(r.auction.starting_price)}</strong><span>{dateTime(r.auction.starts_at)}</span></div> : <span className="adm-muted">—</span>}</td>
                          <td>{r.errors.length ? '' : photoCount(r.registration_number) || <span className="adm-muted">0</span>}</td>
                          <td>{r.errors.length === 0 ? <Badge value="approved" label="OK" />
                            : <ul className="adm-bulk-errors">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AdmTable>
                </div>

                {check.valid > 0 && (
                  <div className="adm-bulk-step">
                    <span className="adm-bulk-num">3</span>
                    <div>
                      <h4>Photos (recommended)</h4>
                      <p className="adm-muted">Choose the main folder that holds one folder per vehicle, named with its registration number or claim number (photo names do not matter). Or name each photo with the registration number (KL07AB1234.jpg, KL07AB1234-2.jpg). Photos are made smaller automatically; at most {MAX_PHOTOS_PER_VEHICLE} per vehicle; the first photo by name is the cover. Vehicles without photos can get them after the import.</p>
                      <input ref={folderInput} type="file" hidden multiple webkitdirectory="" directory="" onChange={(e) => { setPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} aria-label="Photos folder" />
                      <input ref={photoInput} type="file" hidden multiple accept="image/jpeg,image/png" onChange={(e) => { setPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} aria-label="Photo files" />
                      <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="adm-btn small" disabled={running} onClick={() => folderInput.current?.click()}><FolderOpen size={14} /> Choose photos folder</button>
                        <button type="button" className="adm-btn small" disabled={running} onClick={() => photoInput.current?.click()}><ImagePlus size={14} /> Choose photo files</button>
                      </div>
                      {photos.length > 0 && (
                        <div className="adm-bulk-photos">
                          <span><strong>{[...matched.byReg.values()].reduce((a, l) => a + l.length, 0)}</strong> photos matched to <strong>{matched.byReg.size}</strong> vehicles</span>
                          {withoutPhotos > 0 && <span className="warn">{withoutPhotos} vehicle(s) without photos stay as drafts</span>}
                          {matched.unmatched.length > 0 && (
                            <details><summary>{matched.unmatched.length} photo(s) did not match a registration number</summary>
                              <ul>{matched.unmatched.slice(0, 50).map((f) => <li key={f.webkitRelativePath || f.name}>{f.webkitRelativePath || f.name}</li>)}</ul>
                            </details>
                          )}
                          {matched.problems.length > 0 && (
                            <details><summary>{matched.problems.length} photo(s) cannot be used</summary>
                              <ul>{matched.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul>
                            </details>
                          )}
                          {matched.extra > 0 && <span className="warn">{matched.extra} photo(s) over the {MAX_PHOTOS_PER_VEHICLE}-per-vehicle limit are left out</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {check.valid > 0 && (
                  <div className="adm-bulk-step">
                    <span className="adm-bulk-num">4</span>
                    <div>
                      <h4>Import</h4>
                      <label className="adm-check">
                        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} disabled={running} />
                        Publish vehicles that have photos on the website and create their auctions from the file
                      </label>
                      <p className="adm-muted small">Untick to keep everything as drafts and review each vehicle first.</p>
                      {running && (
                        <div className="adm-bulk-progress" role="status">
                          <Loader2 size={15} className="adm-spin" /> {progress.stage}{progress.total > 1 ? ` ${progress.done} / ${progress.total}` : ''}
                          <div className="adm-progress"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
                          <p className="adm-muted small">Keep this window open until it finishes.</p>
                        </div>
                      )}
                      <div className="adm-actions-row" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="adm-btn primary" disabled={running || checking} onClick={run}>
                          <Upload size={15} /> Import {check.valid} vehicle{check.valid === 1 ? '' : 's'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {result && (
          <div className="adm-bulk-result">
            <h4><CheckCircle2 size={18} /> Upload finished</h4>
            <dl className="adm-dl">
              <dt>Vehicles added</dt><dd><strong>{result.created}</strong></dd>
              <dt>Photos uploaded</dt><dd>{result.photos}</dd>
              <dt>Published on the website</dt><dd>{result.published}</dd>
              <dt>Auctions created</dt><dd>{result.auctions}</dd>
              <dt>Left as drafts</dt><dd>{result.drafts}{result.drafts > 0 ? ` (add photos below, or later from ${rtl ? 'Ready to Lift > Drafts' : 'Auctions > Waiting > Need photos'})` : ''}</dd>
              <dt>Rows skipped</dt><dd>{result.skipped.length}</dd>
            </dl>
            {result.skipped.length > 0 && <button type="button" className="adm-btn small" onClick={() => downloadProblems(result.skipped)}><Download size={14} /> Skipped rows</button>}
            {result.draftRows.length > 0 && <DraftPhotos rows={result.draftRows} onPublished={onFinished} rtl={rtl} />}
            {[...result.failed, ...result.photoFailed].length > 0 && (
              <details open><summary>Problems while publishing</summary>
                <ul className="adm-bulk-errors">{[...result.failed, ...result.photoFailed].slice(0, 100).map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            <div className="adm-actions-row">
              <button type="button" className="adm-btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}


/** After an import: add photos to each vehicle that is still a draft, then publish them (with their auctions). */
function DraftPhotos({ rows, onPublished, rtl }) {
  const [openId, setOpenId] = useState(rows[0]?.vehicle_id || null);
  const [counts, setCounts] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState([]);
  const [published, setPublished] = useState(() => new Set());
  const waiting = rows.filter((r) => !published.has(r.vehicle_id));
  const ready = waiting.filter((r) => counts[r.vehicle_id] > 0);

  const publishReady = async () => {
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const res = await bulkPublish({ items: ready.map((r) => ({ vehicle_id: r.vehicle_id, ...(r.auction ? { auction: r.auction } : {}) })) });
      const ok = res.results.filter((r) => !r.error).map((r) => r.vehicle_id);
      setPublished((prev) => new Set([...prev, ...ok]));
      setErrors(res.results.filter((r) => r.error).map((r) => `${r.registration_number}: ${r.error}`));
      setMessage(`${ok.length} vehicle(s) published${res.auctions ? `, ${res.auctions} auction(s) created` : ''}.`);
      onPublished?.();
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setBusy(false);
    }
  };

  if (waiting.length === 0) {
    return <div className="adm-bulk-drafts"><p className="adm-alert adm-alert-success">All vehicles from this file are published.</p></div>;
  }
  return (
    <div className="adm-bulk-drafts">
      <h4>Add photos to the vehicles still in draft ({waiting.length})</h4>
      <p className="adm-muted small">Open a vehicle, take or choose its photos, then publish. You can also do this later from {rtl ? 'Ready to Lift > Drafts' : 'Auctions > Waiting > Need photos'}.</p>
      {message && <p className="adm-alert adm-alert-success">{message}</p>}
      {errors.length > 0 && <ul className="adm-bulk-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="adm-bulk-draft-list">
        {waiting.map((r) => (
          <div key={r.vehicle_id} className={`adm-bulk-draft${openId === r.vehicle_id ? ' open' : ''}`}>
            <button type="button" className="adm-bulk-draft-head" onClick={() => setOpenId(openId === r.vehicle_id ? null : r.vehicle_id)}>
              <span className="mono">{r.registration_number}</span>
              <span>{r.title}</span>
              <span className={counts[r.vehicle_id] ? 'ok' : 'adm-muted'}>{counts[r.vehicle_id] ? `${counts[r.vehicle_id]} photo(s)` : 'No photos'}</span>
            </button>
            {openId === r.vehicle_id && (
              <DraftPhotoBox vehicleId={r.vehicle_id} onCount={(n) => setCounts((c) => ({ ...c, [r.vehicle_id]: n }))} />
            )}
          </div>
        ))}
      </div>
      <div className="adm-actions-row">
        <button type="button" className="adm-btn primary" disabled={busy || ready.length === 0} onClick={publishReady}>
          {busy ? <Loader2 size={15} className="adm-spin" /> : <Upload size={15} />} Publish {ready.length} vehicle{ready.length === 1 ? '' : 's'} with photos
        </button>
      </div>
    </div>
  );
}

function DraftPhotoBox({ vehicleId, onCount }) {
  const { data, error, reload } = useLoad(async () => {
    const v = await getVehicle(vehicleId);
    onCount(v.photos.length);
    return v;
  }, [vehicleId]);
  if (!data) return error ? <ErrorBox message={error} onRetry={reload} /> : <Spinner />;
  return <PhotoManager vehicleId={vehicleId} photos={data.photos} onChanged={reload} />;
}
