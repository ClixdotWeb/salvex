// Vehicles (backend/app/api/vehicles.py): sellers and admins manage vehicles; the catalogue is public.
import { apiRequest, apiUrl } from './client';

export const PHOTO_TYPES = ['image/jpeg', 'image/png'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// The company's field list, in display order. `options` fields use the server's option lists.
export const VEHICLE_FIELDS = [
  { name: 'listing_type', label: 'Listing', choices: { auction: 'Auction', ready_to_lift: 'Ready to Lift (no auction)' } },
  { name: 'registration_number', label: 'Registration number', placeholder: 'KL07AB1234' },
  { name: 'claim_number', label: 'Claim number' },
  { name: 'make', label: 'Make', placeholder: 'Maruti Suzuki' },
  { name: 'model', label: 'Model', placeholder: 'Swift' },
  { name: 'variant', label: 'Variant', placeholder: 'VXi' },
  { name: 'manufacturing_year', label: 'Manufacturing year', type: 'number' },
  { name: 'registration_year', label: 'Registration year', type: 'number' },
  { name: 'fuel_type', label: 'Fuel type', options: true },
  { name: 'transmission', label: 'Transmission', options: true },
  { name: 'number_of_owners', label: 'Number of owners', type: 'number' },
  // needed for Ready to Lift, optional for auctions
  { name: 'km_driven', label: 'KM driven', type: 'number', placeholder: 'e.g. 48210', requiredIf: (v) => v.listing_type === 'ready_to_lift' },
  { name: 'superdari', label: 'Superdari', choices: { yes: 'Yes', no: 'No' }, bool: true, requiredIf: (v) => v.listing_type === 'ready_to_lift' },
  { name: 'damage_type', label: 'Damage type', options: true },
  // Shown (and required) only when the damage type is "Other".
  { name: 'damage_other', label: 'Describe the damage', placeholder: 'e.g. Rat bite on wiring', showIf: (v) => v.damage_type === 'other' },
  { name: 'location', label: 'Vehicle location', placeholder: 'Kochi Yard' },
  { name: 'rc_status', label: 'RC status', options: true },
  { name: 'registration_type', label: 'Registration type', options: true },
  { name: 'hypothecation_status', label: 'Hypothecation status', options: true },
  // Auctions only: Ready to Lift vehicles have no auction (the field is hidden and not sent)
  { name: 'category', label: 'Auction category', options: true, showIf: (v) => v.listing_type !== 'ready_to_lift', omitWhenHidden: true },
];
// Thumbnails (small photos for lists) exist for photos uploaded after 2026-10-25; older ones fall back to the full photo.

export const getVehicleOptions = () => apiRequest('/api/catalogue/vehicle-options');

export const createVehicle = (body) => apiRequest('/api/vehicles', { method: 'POST', body });
export const updateVehicle = (id, body) => apiRequest(`/api/vehicles/${id}`, { method: 'PATCH', body });
export const getMyVehicle = (id) => apiRequest(`/api/vehicles/${id}`);
export const listMyVehicles = (page = 1) => apiRequest(`/api/vehicles/mine?page=${page}&page_size=50`);
export const submitVehicle = (id) => apiRequest(`/api/vehicles/${id}/submit`, { method: 'POST' });
export const uploadPhoto = (id, file) => apiRequest(`/api/vehicles/${id}/photos`, { method: 'POST', file });
export const uploadThumbnail = (id, photoId, file) => apiRequest(`/api/vehicles/${id}/photos/${photoId}/thumbnail`, { method: 'PUT', file });
export const reorderPhotos = (id, photoIds) => apiRequest(`/api/vehicles/${id}/photos/order`, { method: 'PUT', body: { photo_ids: photoIds } });
export const deletePhoto = (id, photoId) => apiRequest(`/api/vehicles/${id}/photos/${photoId}`, { method: 'DELETE' });
export const checkRegistration = (number) =>
  apiRequest(`/api/vehicles/registration-check?number=${encodeURIComponent(number)}`);

/** Photo of a vehicle the viewer owns or (as admin) manages - any status. */
export const ownPhotoUrl = (vehicleId, photoId, size) => apiUrl(`/api/vehicles/${vehicleId}/photos/${photoId}${size === 'thumb' ? '?size=thumb' : ''}`);
/** Photo of an approved vehicle - public. */
export const publicPhotoUrl = (vehicleId, photoId, size) => apiUrl(`/api/catalogue/vehicles/${vehicleId}/photos/${photoId}${size === 'thumb' ? '?size=thumb' : ''}`);

export const listCatalogue = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return apiRequest(`/api/catalogue/vehicles${clean.length ? `?${new URLSearchParams(clean)}` : ''}`);
};
export const getCatalogueVehicle = (id) => apiRequest(`/api/catalogue/vehicles/${id}`);

export function photoProblem(file) {
  if (!PHOTO_TYPES.includes(file.type)) return `${file.name}: only JPEG and PNG photos are accepted.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: larger than 5 MB.`;
  return null;
}

export function vehicleTitle(v) {
  return `${v.manufacturing_year} ${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ''}`;
}
