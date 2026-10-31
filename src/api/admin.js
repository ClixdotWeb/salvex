// Administrator API calls (backend/app/api/admin.py). Every route requires an admin session.
import { apiRequest, apiUrl } from './client';

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? `?${new URLSearchParams(clean)}` : '';
};

export const getDashboard = () => apiRequest('/api/admin/dashboard');

// users
export const listUsers = (params) => apiRequest(`/api/admin/users${qs(params)}`);
export const getUser = (id) => apiRequest(`/api/admin/users/${id}`);
export const suspendUser = (id, reason) => apiRequest(`/api/admin/users/${id}/suspend`, { method: 'POST', body: { reason } });
export const reactivateUser = (id, reason) =>
  apiRequest(`/api/admin/users/${id}/reactivate`, { method: 'POST', body: reason ? { reason } : {} });
export const changeUserRole = (id, role, reason) =>
  apiRequest(`/api/admin/users/${id}/role`, { method: 'POST', body: { role, reason } });

// KYC
export const listKyc = (params) => apiRequest(`/api/admin/kyc/submissions${qs(params)}`);
export const getKyc = (id) => apiRequest(`/api/admin/kyc/submissions/${id}`);
export const decideKyc = (id, decision, reason) =>
  apiRequest(`/api/admin/kyc/submissions/${id}/decision`, { method: 'POST', body: { decision, reason } });

// vehicles (creating and editing use the shared /api/vehicles routes, see ./vehicles.js)
export const listVehicles = (params) => apiRequest(`/api/admin/vehicles${qs(params)}`);
export const getVehicle = (id) => apiRequest(`/api/admin/vehicles/${id}`);
export const reviewVehicle = (id, decision, reason) =>
  apiRequest(`/api/admin/vehicles/${id}/review`, { method: 'POST', body: reason ? { decision, reason } : { decision } });

// auctions
export const listAuctions = (params) => apiRequest(`/api/admin/auctions${qs(params)}`);
export const listResults = (params) => apiRequest(`/api/admin/results${qs(params)}`);
export const getResult = (id) => apiRequest(`/api/admin/results/${id}`);
// deal & service fee (recorded by the admin; money moves outside the website)
export const updateDeal = (orderId, body) => apiRequest(`/api/admin/orders/${orderId}/deal`, { method: 'PATCH', body });
export const addFeePayment = (orderId, body) => apiRequest(`/api/admin/orders/${orderId}/fees`, { method: 'POST', body });
// monthly report
export const getMonthlyReport = (month) => apiRequest(`/api/admin/reports/monthly${qs({ month })}`);
export const reportExportUrl = (month, section) => apiUrl(`/api/admin/reports/monthly/export${qs({ month, section })}`);
export const getAuction = (id) => apiRequest(`/api/admin/auctions/${id}`);
export const createAuction = (body) => apiRequest('/api/admin/auctions', { method: 'POST', body });
export const updateAuction = (id, body) => apiRequest(`/api/admin/auctions/${id}`, { method: 'PATCH', body });
export const auctionAction = (id, action, body) =>
  apiRequest(`/api/admin/auctions/${id}/${action}`, { method: 'POST', body: body || {} });
export const listAuctionBids = (id, params) => apiRequest(`/api/admin/auctions/${id}/bids${qs(params)}`);

// audit trail
export const listAudit = (params) => apiRequest(`/api/admin/audit-logs${qs(params)}`);

// orders & payments
export const listOrders = (params) => apiRequest(`/api/admin/orders${qs(params)}`);
export const getAdminOrder = (id) => apiRequest(`/api/admin/orders/${id}`);
export const confirmPayment = (id) => apiRequest(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST' });
export const rejectPayment = (id, reason) => apiRequest(`/api/admin/orders/${id}/reject-payment`, { method: 'POST', body: { reason } });
export const cancelOrder = (id, reason) => apiRequest(`/api/admin/orders/${id}/cancel`, { method: 'POST', body: { reason } });
export const completeDeal = (id, note) => apiRequest(`/api/admin/orders/${id}/complete`, { method: 'POST', body: note ? { reason: note } : {} });
export const unblockBidding = (id, reason) => apiRequest(`/api/admin/users/${id}/unblock-bidding`, { method: 'POST', body: { reason } });

// Bulk vehicle upload (Excel / CSV) and publishing several vehicles at once (backend/app/api/admin_bulk.py)
export const bulkTemplateUrl = (format = 'xlsx') => apiUrl(`/api/admin/vehicles/bulk-template${qs({ format })}`);
export const bulkCheck = (file, category, listing) => apiRequest(`/api/admin/vehicles/bulk-check${qs({ category, listing })}`, { method: 'POST', file });
export const bulkImport = (file, category, listing) => apiRequest(`/api/admin/vehicles/bulk-import${qs({ category, listing })}`, { method: 'POST', file });
export const bulkPublish = (body) => apiRequest('/api/admin/vehicles/bulk-publish', { method: 'POST', body });

// Search across the admin (backend/app/api/admin_search.py)
export const adminSearch = (q) => apiRequest(`/api/admin/search${qs({ q })}`);
export const getBuyerOverview = (id) => apiRequest(`/api/admin/users/${id}/overview`);
export const getVehicleOverview = (id) => apiRequest(`/api/admin/vehicles/${id}/overview`);
