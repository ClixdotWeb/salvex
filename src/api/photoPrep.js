// Vehicle photos are made smaller in the browser before upload:
//   photo      - at most 1600 px on the long side, JPEG, about 200-400 KB (a phone photo is 3-8 MB)
//   thumbnail  - 480 px, for lists and cards
// Drawing on a canvas also drops the hidden EXIF data (GPS location, phone model) and applies the phone's rotation.
// The server removes metadata again for any other upload path.
import { uploadPhoto, uploadThumbnail } from './vehicles';

export const PHOTO_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 480;
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;     // what the admin may choose; it is shrunk before upload
const SERVER_MAX_BYTES = 5 * 1024 * 1024;

const SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Problem with a chosen photo before it is prepared, or null. */
export function sourcePhotoProblem(file) {
  const typeOk = SOURCE_TYPES.includes(file.type) || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!typeOk) return `${file.name}: only JPEG and PNG photos are accepted.`;
  if (file.size > MAX_SOURCE_BYTES) return `${file.name}: larger than 40 MB.`;
  return null;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(source, maxSide, quality, square = false) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  // square: the centre 1:1 part of the photo (bulk uploads; photos added by hand are cropped by the admin)
  const side = Math.min(w, h);
  const [sx, sy, sw, sh] = square ? [(w - side) / 2, (h - side) / 2, side, side] : [0, 0, w, h];
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';                          // PNG transparency becomes white in the JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality));
}

/** { photo, thumb } ready to upload. If the browser cannot read the image, the original file is sent as it is. */
export async function preparePhoto(file, { square = false } = {}) {
  let image;
  try {
    image = await decode(file);
  } catch {
    return { photo: file, thumb: null };
  }
  try {
    const [photo, thumb] = await Promise.all([draw(image, PHOTO_MAX_SIDE, 0.82, square), draw(image, THUMB_MAX_SIDE, 0.72, square)]);
    const keepOriginal = !square && (!photo || (photo.size >= file.size && file.size <= SERVER_MAX_BYTES && file.type === 'image/jpeg'));
    return { photo: keepOriginal ? file : photo, thumb };
  } finally {
    image.close?.();
  }
}

/** Shrink, upload, then upload the thumbnail (a failed thumbnail is not an error: the photo is used instead). */
export async function uploadVehiclePhoto(vehicleId, file, { square = false } = {}) {
  const { photo, thumb } = await preparePhoto(file, { square });
  if (photo.size > SERVER_MAX_BYTES) throw new Error(`${file.name}: could not be made smaller than 5 MB.`);
  const body = photo instanceof File ? photo : new File([photo], `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  const saved = await uploadPhoto(vehicleId, body);
  if (thumb && thumb.size <= 400 * 1024) {
    try { await uploadThumbnail(vehicleId, saved.id, new File([thumb], 'thumb.jpg', { type: 'image/jpeg' })); } catch { /* optional */ }
  }
  return saved;
}
