import React, { useMemo, useState } from 'react';
import { Gavel, Loader2 } from 'lucide-react';
import { bulkPublish, listVehicles } from '../api/admin';
import DateTimePicker from '../components/ui/DateTimePicker';
import { vehicleTitle } from '../api/vehicles';
import { AdmTable, Empty, ErrorBox, Modal, Spinner, VehicleCell, dateTime, money, useLoad } from './ui';

// The date-time picker is local time without a zone; the server needs a zone.
const toLocalInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const MINUTE = 60000;
// Ends after Starts: when the start moves past the end, the end moves with it (keeping the old length, or 1 hour).
const followStart = (form, nextStart) => {
  const oldStart = new Date(form.starts_at).getTime();
  const oldEnd = new Date(form.ends_at).getTime();
  const start = new Date(nextStart).getTime();
  if (Number.isNaN(start) || (!Number.isNaN(oldEnd) && oldEnd > start)) return { ...form, starts_at: nextStart };
  const length = !Number.isNaN(oldEnd) && !Number.isNaN(oldStart) && oldEnd > oldStart ? oldEnd - oldStart : 3600000;
  return { ...form, starts_at: nextStart, ends_at: toLocalInput(new Date(start + length)) };
};


/** Admin: choose several approved vehicles and create their auctions in one go (same start, staggered ends). */
export default function BulkAuctions({ onClose, onDone }) {
  const list = useLoad(() => listVehicles({ ready_for_auction: true, page_size: 100 }), []);
  const [selected, setSelected] = useState(() => new Set());
  const [prices, setPrices] = useState({});
  const [form, setForm] = useState(() => {
    const now = Date.now();
    return { starts_at: toLocalInput(new Date(now + 30 * MINUTE)), ends_at: toLocalInput(new Date(now + 24 * 60 * MINUTE)),
      gap: '2', extension_enabled: true, extension_minutes: '2', same_price: '' };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const vehicles = list.data?.items || [];
  const chosen = vehicles.filter((v) => selected.has(v.id));
  const set = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChosen = vehicles.length > 0 && chosen.length === vehicles.length;

  const plan = useMemo(() => {
    const starts = new Date(form.starts_at);
    const firstEnd = new Date(form.ends_at);
    const gap = Math.max(0, Number(form.gap) || 0);
    return chosen.map((v, i) => ({ vehicle: v, starts, ends: new Date(firstEnd.getTime() + i * gap * MINUTE) }));
  }, [chosen, form.starts_at, form.ends_at, form.gap]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (chosen.length === 0) { setError('Choose at least one vehicle.'); return; }
    const missing = chosen.filter((v) => !(Number(prices[v.id]) > 0));
    if (missing.length) { setError(`Enter a starting price for ${missing.map((v) => v.registration_number).join(', ')}.`); return; }
    if (!(new Date(form.ends_at) > new Date(form.starts_at))) { setError('The end must be after the start.'); return; }
    setBusy(true);
    try {
      const res = await bulkPublish({
        extension_enabled: form.extension_enabled,
        ...(form.extension_enabled && form.extension_minutes ? { extension_minutes: Number(form.extension_minutes) } : {}),
        items: plan.map((p) => ({ vehicle_id: p.vehicle.id, auction: {
          starting_price: String(prices[p.vehicle.id]).replace(/,/g, ''), starts_at: p.starts.toISOString(), ends_at: p.ends.toISOString() } })),
      });
      setResult(res);
      if (res.auctions > 0) onDone?.(`${res.auctions} auction${res.auctions === 1 ? '' : 's'} created.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const failed = result.results.filter((r) => r.error);
    return (
      <Modal title="Create auctions" onClose={onClose} wide>
        <div className="adm-bulk-result">
          <h4><Gavel size={18} /> {result.auctions} auction{result.auctions === 1 ? '' : 's'} created</h4>
          {failed.length > 0 && (
            <>
              <p className="adm-muted">{failed.length} could not be created:</p>
              <ul className="adm-bulk-errors">{failed.map((r) => <li key={r.vehicle_id}>{r.registration_number}: {r.error}</li>)}</ul>
            </>
          )}
          <div className="adm-actions-row"><button type="button" className="adm-btn primary" onClick={onClose}>Done</button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create auctions" onClose={() => { if (!busy) onClose(); }} wide>
      <form className="adm-form adm-bulk" onSubmit={submit}>
        <p className="adm-muted">Approved vehicles that are not in an auction. Tick the vehicles, enter each starting price, and choose the times. A gap makes the auctions end one after another.</p>
        <div className="adm-grid-2">
          <div className="adm-field"><span>Auctions start</span><DateTimePicker aria-label="Auctions start" value={form.starts_at} min={toLocalInput(new Date())} onChange={(e) => setForm((f) => followStart(f, e.target.value))} /></div>
          <div className="adm-field"><span>First auction ends</span><DateTimePicker aria-label="First auction ends" value={form.ends_at} min={form.starts_at} onChange={(e) => set('ends_at', e.target.value)} /></div>
          <label className="adm-field"><span>Gap between endings (minutes)</span><input type="number" min="0" max="120" value={form.gap} onChange={(e) => set('gap', e.target.value)} /></label>
          <div className="adm-field">
            <span>Bid in the last minutes</span>
            <label className="adm-check"><input type="checkbox" checked={form.extension_enabled} onChange={(e) => set('extension_enabled', e.target.checked)} /> Extend the auction</label>
            {form.extension_enabled && (
              <label className="adm-inline-field">by <input type="number" min="1" max="60" value={form.extension_minutes} onChange={(e) => set('extension_minutes', e.target.value)} /> min</label>
            )}
          </div>
        </div>

        <ErrorBox message={list.error} onRetry={list.reload} />
        {!list.data && list.loading && <Spinner />}
        {list.data && (vehicles.length === 0 ? <Empty>No approved vehicles are waiting for an auction.</Empty> : (
          <>
            <div className="adm-bulk-summary">
              <label className="adm-check"><input type="checkbox" checked={allChosen}
                onChange={(e) => setSelected(e.target.checked ? new Set(vehicles.map((v) => v.id)) : new Set())} /> Select all ({vehicles.length})</label>
              <span className="adm-inline-field">Same starting price for selected
                <input type="number" min="1" value={form.same_price} placeholder="₹" onChange={(e) => set('same_price', e.target.value)} aria-label="Same starting price" />
                <button type="button" className="adm-btn small" disabled={!form.same_price || chosen.length === 0}
                  onClick={() => setPrices((p) => ({ ...p, ...Object.fromEntries(chosen.map((v) => [v.id, form.same_price])) }))}>Apply</button>
              </span>
            </div>
            <div className="adm-bulk-table">
              <AdmTable>
                <thead><tr><th /><th>Vehicle</th><th>Location</th><th>Starting price (₹)</th><th>Ends</th></tr></thead>
                <tbody>
                  {vehicles.map((v) => {
                    const planned = plan.find((p) => p.vehicle.id === v.id);
                    return (
                      <tr key={v.id} className={selected.has(v.id) ? 'adm-row-selected' : ''}>
                        <td><input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.registration_number}`} /></td>
                        <td className="adm-cell-main"><VehicleCell vehicleId={v.id} photoId={v.cover_photo_id} title={vehicleTitle(v)} sub={v.registration_number} /></td>
                        <td>{v.location}</td>
                        <td><input className="adm-price-input" type="number" min="1" inputMode="numeric" value={prices[v.id] || ''} aria-label={`Starting price ${v.registration_number}`}
                          onChange={(e) => { setPrices((p) => ({ ...p, [v.id]: e.target.value })); if (!selected.has(v.id) && e.target.value) toggle(v.id); }} /></td>
                        <td>{planned && !Number.isNaN(planned.ends.getTime()) ? dateTime(planned.ends.toISOString()) : <span className="adm-muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdmTable>
            </div>
            {list.data.total > vehicles.length && <p className="adm-muted small">Showing the first {vehicles.length} of {list.data.total}. Create these, then open this again for the rest.</p>}
          </>
        ))}
        <ErrorBox message={error} />
        <div className="adm-actions-row">
          <span className="adm-muted small">{chosen.length} selected{chosen.length ? ` · total starting ${money(chosen.reduce((a, v) => a + (Number(prices[v.id]) || 0), 0))}` : ''}</span>
          <button type="button" className="adm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="adm-btn primary" disabled={busy || chosen.length === 0}>
            {busy ? <Loader2 size={15} className="adm-spin" /> : <Gavel size={15} />} Create {chosen.length || ''} auction{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
