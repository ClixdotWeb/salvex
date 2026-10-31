// Ready to Lift (backend/app/api/ready_to_lift.py and the admin enquiry routes).
import { apiRequest } from './client';

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? `?${new URLSearchParams(clean)}` : '';
};

export const listReadyToLift = (params) => apiRequest(`/api/ready-to-lift${qs(params)}`, { notifyUnauthorized: false });
export const expressInterest = (vehicleId) => apiRequest(`/api/ready-to-lift/${vehicleId}/interest`, { method: 'POST' });
export const listMyInterests = () => apiRequest('/api/ready-to-lift/interests/mine', { notifyUnauthorized: false });

// admin
export const adminListEnquiries = (params) => apiRequest(`/api/admin/enquiries${qs(params)}`);
export const adminGetEnquiry = (id) => apiRequest(`/api/admin/enquiries/${id}`);
export const adminUpdateEnquiry = (id, body) => apiRequest(`/api/admin/enquiries/${id}/update`, { method: 'POST', body });
export const markReadyToLiftSold = (vehicleId, reason) =>
  apiRequest(`/api/admin/vehicles/${vehicleId}/mark-sold`, { method: 'POST', body: reason ? { reason } : {} });
export const reopenReadyToLift = (vehicleId, reason) =>
  apiRequest(`/api/admin/vehicles/${vehicleId}/reopen`, { method: 'POST', body: reason ? { reason } : {} });

export const ENQUIRY_STATUS = {
  new: { label: 'New', tone: 'pending' },
  contacted: { label: 'Contacted', tone: 'upcoming' },
  closed: { label: 'Closed', tone: 'draft' },
};

// The client's note shown above the Ready to Lift list.
export const READY_TO_LIFT_NOTE = 'Vehicles listed under "Ready to Lift" are available for immediate collection. Buyers can '
  + 'collect the vehicle after completing the required payment and documentation formalities. Affidavit submission by the '
  + 'buyer is mandatory at the time of vehicle lifting.';
