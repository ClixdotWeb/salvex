import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { getVehicle, reviewVehicle } from '../api/admin';
import { submitVehicle } from '../api/vehicles';
import PhotoManager from './PhotoManager';
import { ErrorBox, useLoad } from './ui';

/** Step "Photos": add photos, then confirm (submit + approve: the vehicle is published). */
export function PhotoStep({ vehicleId, onBack, onConfirmed, confirmLabel = 'Confirm vehicle', onLater }) {
  const data = useLoad(() => getVehicle(vehicleId), [vehicleId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const photos = data.data?.photos || [];

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitVehicle(vehicleId);
      await reviewVehicle(vehicleId, 'approve');
      onConfirmed(await getVehicle(vehicleId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="adm-form">
      <PhotoManager vehicleId={vehicleId} photos={photos} onChanged={data.reload}
         />
      <ErrorBox message={error || data.error} />
      {photos.length === 0 && <p className="adm-muted small">Add at least one photo to continue.</p>}
      <div className="adm-actions-row">
        <button type="button" className="adm-btn" disabled={busy} onClick={onBack}>Back to details</button>
        {onLater && <button type="button" className="adm-btn" disabled={busy} onClick={onLater}>Save as draft</button>}
        <button type="button" className="adm-btn primary" disabled={busy || photos.length === 0} onClick={confirm}>
          <Check size={15} /> {confirmLabel}
        </button>
      </div>
    </div>
  );
}
