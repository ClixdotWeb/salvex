import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, Loader2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from './ui';

/*
 * Square (1:1) crop for a vehicle photo, before it is uploaded.
 * Drag the photo to place it, zoom with the slider / mouse wheel / pinch, rotate in 90° steps.
 * The result is a JPEG File of at most 1600 x 1600 px.
 */
const OUT_MAX = 1600;
const MAX_ZOOM = 4;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This photo could not be opened.'));
    img.src = src;
  });
}

/** A new image source turned by 90° (the browser already applied the phone's own rotation). */
async function rotated(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  return URL.createObjectURL(blob);
}

export default function PhotoCropper({ file, src: givenSrc, title = 'Crop photo (1:1)', counter, onCancel, onSkip, onCropped, onCropAllCentered }) {
  const [src, setSrc] = useState(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });          // top-left of the photo inside the square, in px
  const [size, setSize] = useState(320);                    // the square on screen, in px
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const frame = useRef(null);
  const drag = useRef(null);
  const urls = useRef([]);

  // the photo to crop
  useEffect(() => {
    let url = givenSrc;
    if (!url && file) { url = URL.createObjectURL(file); urls.current.push(url); }
    setSrc(url);
    setZoom(1);
  }, [file, givenSrc]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    loadImage(src).then((i) => { if (alive) { setImg(i); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [src]);

  // the square fits the window
  useEffect(() => {
    const fit = () => setSize(Math.max(220, Math.min(420, window.innerWidth - 64, window.innerHeight - 320)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const base = img ? size / Math.min(img.naturalWidth, img.naturalHeight) : 1;   // zoom 1 = the photo just covers the square
  const shown = img ? { w: img.naturalWidth * base * zoom, h: img.naturalHeight * base * zoom } : { w: size, h: size };
  const clamp = useCallback((p, w = shown.w, h = shown.h) => ({
    x: Math.min(0, Math.max(size - w, p.x)), y: Math.min(0, Math.max(size - h, p.y)),
  }), [shown.w, shown.h, size]);

  // centre the photo (whole, zoom 1) when it or the square's size changes
  useEffect(() => {
    if (!img) return;
    const w = img.naturalWidth * base;
    const h = img.naturalHeight * base;
    setZoom(1);
    setPos({ x: (size - w) / 2, y: (size - h) / 2 });
  }, [img, size, base]);

  const zoomTo = (next) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    if (!img) return;
    // keep the centre of the square on the same point of the photo
    const cx = (size / 2 - pos.x) / shown.w;
    const cy = (size / 2 - pos.y) / shown.h;
    const w = img.naturalWidth * base * z;
    const h = img.naturalHeight * base * z;
    setZoom(z);
    setPos(clamp({ x: size / 2 - cx * w, y: size / 2 - cy * h }, w, h));
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    frame.current?.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pos };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.start.x + e.clientX - drag.current.x, y: drag.current.start.y + e.clientY - drag.current.y }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onWheel = (e) => { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 30 : 8;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); setPos((p) => clamp({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] })); }
    if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.2);
    if (e.key === '-') zoomTo(zoom - 0.2);
  };

  // wheel needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const rotate = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const url = await rotated(img);
      urls.current.push(url);
      setSrc(url);
      setZoom(1);
    } finally {
      setBusy(false);
    }
  };

  const crop = async () => {
    if (!img) return;
    setBusy(true);
    const scale = base * zoom;
    const side = size / scale;                      // the square, in photo pixels
    const out = Math.round(Math.min(OUT_MAX, side));
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, side, side, 0, 0, out, out);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    const name = `${(file?.name || 'photo').replace(/\.[^.]+$/, '')}-square.jpg`;
    setBusy(false);
    onCropped(new File([blob], name, { type: 'image/jpeg' }));
  };

  return (
    <Modal title={counter ? `${title} · ${counter}` : title} onClose={onCancel} onTop>
      <div className="adm-cropper">
        <p className="adm-muted small">Drag the photo to place it in the square. Zoom with the slider (or the mouse wheel). The photo is saved as this square.</p>
        {error ? <p className="adm-alert adm-alert-error">{error}</p> : (
          <div ref={frame} className="adm-crop-frame" style={{ width: size, height: size }} tabIndex={0} role="application"
            aria-label="Crop area: drag to move, plus and minus to zoom, arrow keys to move"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
            {img ? (
              <img src={src} alt="" draggable={false}
                style={{ width: shown.w, height: shown.h, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
            ) : <span className="adm-crop-loading"><Loader2 size={20} className="adm-spin" /></span>}
            <span className="adm-crop-grid" aria-hidden="true" />
          </div>
        )}
        <div className="adm-crop-controls">
          <button type="button" className="adm-icon-btn" aria-label="Zoom out" onClick={() => zoomTo(zoom - 0.2)} disabled={!img || zoom <= 1}><ZoomOut size={16} /></button>
          <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} aria-label="Zoom" disabled={!img}
            onChange={(e) => zoomTo(Number(e.target.value))} />
          <button type="button" className="adm-icon-btn" aria-label="Zoom in" onClick={() => zoomTo(zoom + 0.2)} disabled={!img || zoom >= MAX_ZOOM}><ZoomIn size={16} /></button>
          <button type="button" className="adm-btn small" onClick={rotate} disabled={!img || busy}><RotateCw size={14} /> Rotate</button>
        </div>
        <div className="adm-actions-row">
          {onCropAllCentered && <button type="button" className="adm-btn" disabled={busy} onClick={onCropAllCentered}>Crop the rest from the centre</button>}
          {onSkip && <button type="button" className="adm-btn" disabled={busy} onClick={onSkip}>Skip this photo</button>}
          <button type="button" className="adm-btn primary" disabled={!img || busy} onClick={crop}>
            {busy ? <Loader2 size={15} className="adm-spin" /> : <Crop size={15} />} Crop and use
          </button>
        </div>
      </div>
    </Modal>
  );
}
