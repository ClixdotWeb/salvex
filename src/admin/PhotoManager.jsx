import React, { useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Crop, Loader2, Star, Trash2 } from 'lucide-react';
import { deletePhoto, ownPhotoUrl, reorderPhotos } from '../api/vehicles';
import { sourcePhotoProblem, uploadVehiclePhoto } from '../api/photoPrep';
import { ErrorBox } from './ui';
import PhotoCropper from './PhotoCropper';

const MAX_PHOTOS = 20;

/**
 * Vehicle photos for admins: take photos with the phone camera or choose / drop files, crop each one to a square
 * (1:1), set the cover, change the order, crop again, delete. Photos are shrunk in the browser before upload.
 * The first photo is the cover on the website.
 */
// keepOne: the vehicle is on the website, so its last photo cannot be deleted (crop it instead).
export default function PhotoManager({ vehicleId, photos, editable = true, keepOne = false, onChanged, hint }) {
  const [busy, setBusy] = useState(null);           // null | { done, total } | 'order'
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState(null);         // new photos being cropped: { files, index, cropped }
  const [recrop, setRecrop] = useState(null);       // an existing photo being cropped again: { photo, index }
  const photoInput = useRef(null);
  const room = MAX_PHOTOS - photos.length;

  const upload = async (items) => {                 // items: [{ file, square }]
    const failed = [];
    for (let i = 0; i < items.length; i += 1) {          // one at a time, in the chosen order
      setBusy({ done: i, total: items.length });
      try { await uploadVehiclePhoto(vehicleId, items[i].file, { square: items[i].square }); } catch (err) { failed.push(err.message); }
    }
    setBusy(null);
    if (failed.length) setError(failed.join(' '));
    onChanged?.();
  };

  const add = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError(null);
    const problems = files.map(sourcePhotoProblem).filter(Boolean);
    if (problems.length) { setError(problems.join(' ')); return; }
    if (files.length > room) { setError(`A vehicle can have at most ${MAX_PHOTOS} photos (${room} more).`); return; }
    setQueue({ files, index: 0, cropped: [] });          // crop each photo to 1:1, then upload them
  };

  const nextInQueue = (q, cropped) => {
    if (q.index + 1 < q.files.length) { setQueue({ ...q, index: q.index + 1, cropped }); return; }
    setQueue(null);
    if (cropped.length) upload(cropped);
  };

  const replaceWithCrop = async (file) => {
    const { photo: old, index } = recrop;
    setRecrop(null);
    setBusy({ done: 0, total: 1 });
    setError(null);
    try {
      const saved = await uploadVehiclePhoto(vehicleId, file);
      await deletePhoto(vehicleId, old.id);
      const ids = photos.map((p) => (p.id === old.id ? saved.id : p.id));
      if (ids.indexOf(saved.id) !== index || ids.length !== photos.length) ids.splice(index, 1, saved.id);
      await reorderPhotos(vehicleId, ids);
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
    onChanged?.();
  };

  const move = async (from, to) => {
    if (to < 0 || to >= photos.length) return;
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setBusy('order');
    setError(null);
    try { await reorderPhotos(vehicleId, ids); } catch (err) { setError(err.message); }
    setBusy(null);
    onChanged?.();
  };

  const remove = async (photoId) => {
    if (!window.confirm('Delete this photo?')) return;
    setError(null);
    try { await deletePhoto(vehicleId, photoId); } catch (err) { setError(err.message); }
    onChanged?.();
  };

  const working = Boolean(busy);
  return (
    <div
      className={`adm-photo-manager${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { if (editable && !working) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (editable && !working) add(e.dataTransfer.files); }}
    >
      {editable && (
        <div className="adm-photo-actions">
          <button type="button" className="adm-btn small primary" disabled={working || room <= 0} onClick={() => photoInput.current?.click()}>
            <Camera size={14} /> Add photos
          </button>
          <span className="adm-muted small">{hint || 'On a phone: take photos with the camera or pick them from the gallery. On a computer: choose or drop them here. The first photo is the cover.'}</span>
          <input ref={photoInput} type="file" accept="image/*" multiple hidden aria-label="Add photos"
            onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {busy && busy !== 'order' && (
        <p className="adm-muted small" role="status"><Loader2 size={13} className="adm-spin" /> Uploading photo {busy.done + 1} of {busy.total}…</p>
      )}
      <ErrorBox message={error} />
      {photos.length === 0 ? <p className="adm-muted">No photos yet. At least one is needed to publish.</p> : (
        <div className="adm-photos">
          {photos.map((p, i) => (
            <figure key={p.id}>
              <img src={ownPhotoUrl(vehicleId, p.id, 'thumb')} alt={`Photo ${i + 1}`} loading="lazy" />
              <figcaption>{i === 0 ? 'Cover' : `Photo ${i + 1}`}</figcaption>
              {editable && (
                <>
                  <button type="button" className="adm-photo-del" aria-label={`Delete photo ${i + 1}`} disabled={working || (keepOne && photos.length === 1)}
                    title={keepOne && photos.length === 1 ? 'A vehicle on the website needs at least one photo' : 'Delete photo'} onClick={() => remove(p.id)}>
                    <Trash2 size={13} />
                  </button>
                  <div className="adm-photo-tools">
                    <button type="button" aria-label={`Move photo ${i + 1} left`} disabled={working || i === 0} onClick={() => move(i, i - 1)}><ChevronLeft size={14} /></button>
                    <button type="button" aria-label={`Crop photo ${i + 1}`} title="Crop" disabled={working} onClick={() => setRecrop({ photo: p, index: i })}><Crop size={13} /></button>
                    {i > 0 && <button type="button" aria-label={`Make photo ${i + 1} the cover`} title="Make cover" disabled={working} onClick={() => move(i, 0)}><Star size={13} /></button>}
                    <button type="button" aria-label={`Move photo ${i + 1} right`} disabled={working || i === photos.length - 1} onClick={() => move(i, i + 1)}><ChevronRight size={14} /></button>
                  </div>
                </>
              )}
            </figure>
          ))}
        </div>
      )}

      {queue && (
        <PhotoCropper key={queue.index} file={queue.files[queue.index]}
          counter={queue.files.length > 1 ? `${queue.index + 1} of ${queue.files.length}` : null}
          onCancel={() => { const done = queue.cropped; setQueue(null); if (done.length) upload(done); }}
          onSkip={queue.files.length > 1 ? () => nextInQueue(queue, queue.cropped) : null}
          onCropAllCentered={queue.files.length - queue.index > 1 ? () => {
            const rest = queue.files.slice(queue.index).map((file) => ({ file, square: true }));
            const all = [...queue.cropped, ...rest];
            setQueue(null);
            upload(all);
          } : null}
          onCropped={(file) => nextInQueue(queue, [...queue.cropped, { file, square: false }])} />
      )}
      {recrop && (
        <PhotoCropper src={ownPhotoUrl(vehicleId, recrop.photo.id)} title={`Crop photo ${recrop.index + 1} (1:1)`}
          onCancel={() => setRecrop(null)} onCropped={replaceWithCrop} />
      )}
    </div>
  );
}
