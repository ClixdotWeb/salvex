import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { VEHICLE_FIELDS, getVehicleOptions } from '../api/vehicles';
import Select from './ui/Select';

const EMPTY = { ...Object.fromEntries(VEHICLE_FIELDS.map((f) => [f.name, ''])), listing_type: 'auction' };

/**
 * The company's 14 vehicle fields (all required). Used by admins and sellers.
 * `onSave(values)` must return a promise; server field errors (422) are shown next to each field.
 */
// The listing (auction / Ready to Lift) comes from where the vehicle is added, so it is never a field to choose:
// `listing` fixes it ("auctionOnly" = auction, for the New auction wizard and sellers).
export default function VehicleForm({ initial, onSave, onCancel, saveLabel = 'Save vehicle', disabled, auctionOnly, listing }) {
  const fixedListing = listing || (auctionOnly ? 'auction' : null);
  const [values, setValues] = useState(() => ({ ...EMPTY, ...pick(initial), ...(fixedListing ? { listing_type: fixedListing } : {}) }));
  const [options, setOptions] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVehicleOptions().then(setOptions).catch(() => setMessage('Could not load the option lists. Please refresh.'));
  }, []);

  const set = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const shown = VEHICLE_FIELDS.filter((f) => !f.showIf || f.showIf(values));
    const required = (f) => (f.requiredIf ? f.requiredIf(values) : true);
    const missing = Object.fromEntries(shown.filter((f) => required(f) && String(values[f.name] ?? '').trim() === '').map((f) => [f.name, 'Required']));
    if (Object.keys(missing).length) { setErrors(missing); setMessage('Please fill in every field.'); return; }
    const body = Object.fromEntries(VEHICLE_FIELDS.filter((f) => !(f.omitWhenHidden && f.showIf && !f.showIf(values))).map((f) => {
      if (f.showIf && !f.showIf(values)) return [f.name, null];
      const raw = String(values[f.name] ?? '').trim();
      if (f.bool) return [f.name, raw === '' ? null : raw === 'yes'];
      if (f.requiredIf && raw === '') return [f.name, null];
      return [f.name, f.type === 'number' ? Number(raw) : raw];
    }));
    setBusy(true);
    setMessage(null);
    try {
      await onSave(body);
    } catch (err) {
      setErrors(err.fieldErrors || {});
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="vehicle-form" onSubmit={submit} noValidate>
      <div className="vehicle-form-grid">
        {VEHICLE_FIELDS.filter((f) => (!f.showIf || f.showIf(values)) && f.name !== 'listing_type').map((f) => (
          <label key={f.name} className={`vf-field${errors[f.name] ? ' has-error' : ''}`}>
            <span>{f.label}{!f.requiredIf || f.requiredIf(values) ? ' *' : ' (optional)'}</span>
            {f.choices ? (
              <Select value={values[f.name]} disabled={disabled} onChange={(e) => set(f.name, e.target.value)}>
                {f.name !== 'listing_type' && <option value="" disabled>Select…</option>}
                {Object.entries(f.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            ) : f.options ? (
              <Select value={values[f.name]} disabled={disabled || !options} onChange={(e) => set(f.name, e.target.value)}>
                <option value="" disabled>Select…</option>
                {options && Object.entries(options[f.name] || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            ) : (
              <input type={f.type || 'text'} value={values[f.name]} placeholder={f.placeholder} disabled={disabled}
                inputMode={f.type === 'number' ? 'numeric' : undefined} onChange={(e) => set(f.name, e.target.value)} />
            )}
            {errors[f.name] && <em>{errors[f.name]}</em>}
          </label>
        ))}
      </div>
      {message && <p className="vf-message" role="alert">{message}</p>}
      {!disabled && (
        <div className="vf-actions">
          {onCancel && <button type="button" className="adm-btn" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="adm-btn primary" disabled={busy}>
            {busy && <Loader2 size={14} className="adm-spin" />} {saveLabel}
          </button>
        </div>
      )}
    </form>
  );
}

function pick(vehicle) {
  if (!vehicle) return {};
  return Object.fromEntries(VEHICLE_FIELDS.map((f) => {
    const value = vehicle[f.name];
    if (f.bool) return [f.name, value === true ? 'yes' : value === false ? 'no' : ''];
    return [f.name, value ?? ''];
  }));
}
