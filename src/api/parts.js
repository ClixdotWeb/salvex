// Spare parts (backend/app/api/parts.py and the admin routes).
import { apiRequest, apiUrl } from './client';

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? `?${new URLSearchParams(clean)}` : '';
};

export const listParts = (params) => apiRequest(`/api/parts${qs(params)}`, { notifyUnauthorized: false });
export const partPhotoUrl = (id) => apiUrl(`/api/parts/${id}/photo`);
export const createPartRequest = (body) => apiRequest('/api/part-requests', { method: 'POST', body });
export const listMyPartRequests = () => apiRequest('/api/part-requests/mine?page_size=100');

// admin
export const adminListParts = (params) => apiRequest(`/api/admin/parts${qs(params)}`);
export const adminCreatePart = (body) => apiRequest('/api/admin/parts', { method: 'POST', body });
export const adminUpdatePart = (id, body) => apiRequest(`/api/admin/parts/${id}`, { method: 'PUT', body });
export const adminPartPhoto = (id, file) => apiRequest(`/api/admin/parts/${id}/photo`, { method: 'POST', file });
export const adminListPartRequests = (params) => apiRequest(`/api/admin/part-requests${qs(params)}`);
export const adminGetPartRequest = (id) => apiRequest(`/api/admin/part-requests/${id}`);
export const adminUpdatePartRequest = (id, body) => apiRequest(`/api/admin/part-requests/${id}/update`, { method: 'POST', body });

// Spare part enquiries: our team calls the customer (like the Ready to Lift enquiries).
export const REQUEST_STATUS = {
  new: { label: 'New', customerLabel: 'Sent', tone: 'amber', badge: 'pending' },
  contacted: { label: 'Contacted', customerLabel: 'Contacted', tone: 'blue', badge: 'upcoming' },
  closed: { label: 'Closed', customerLabel: 'Closed', tone: 'grey', badge: 'draft' },
};
