// Contact page messages (backend/app/api/contact.py and the admin routes).
import { apiRequest } from './client';

// Must match CONTACT_SUBJECTS in backend/app/models/contact.py
export const CONTACT_SUBJECTS = [
  'General enquiry',
  'Registration & KYC',
  'Bidding & auctions',
  'Payments',
  'Selling a vehicle',
  'Spare parts',
  'Vehicle handover',
  'Other',
];

export const sendContactMessage = (body) =>
  apiRequest('/api/contact', { method: 'POST', body, notifyUnauthorized: false });

export const adminListContactMessages = (params = {}) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return apiRequest(`/api/admin/contact-messages${clean.length ? `?${new URLSearchParams(clean)}` : ''}`);
};
export const adminGetContactMessage = (id) => apiRequest(`/api/admin/contact-messages/${id}`);
export const adminUpdateContactMessage = (id, body) =>
  apiRequest(`/api/admin/contact-messages/${id}/update`, { method: 'POST', body });

export const CONTACT_STATUS = {
  new: { label: 'New', tone: 'amber' },
  in_progress: { label: 'In progress', tone: 'blue' },
  closed: { label: 'Closed', tone: 'grey' },
};
