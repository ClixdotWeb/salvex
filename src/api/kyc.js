// Calls to the KYC endpoints (see backend/app/api/kyc.py).
import { apiRequest, apiUrl } from './client';

// Provisional generic list, the same as the backend's (company has not fixed the required documents yet).
// The documents our team checks (all three are needed), plus "other" for anything extra they ask for.
export const DOCUMENT_TYPES = [
  { value: 'aadhaar_card', label: 'Aadhaar card', hint: 'Front and back of your Aadhaar card (you may cover the first 8 digits).' },
  { value: 'pan_card', label: 'PAN card', hint: 'Your PAN card.' },
  { value: 'cancelled_cheque', label: 'Cancelled cheque', hint: 'A cheque from your own bank account with "CANCELLED" written across it.' },
  { value: 'other', label: 'Other document', hint: 'Anything else our team asked you for.' },
];

// Labels for every type, including ones used before (shown on older submissions).
export const DOCUMENT_LABELS = {
  ...Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, t.label])),
  identity_proof: 'Identity proof', address_proof: 'Address proof', business_proof: 'Business proof',
};

export function setAadhaar(submissionId, aadhaarNumber) {
  return apiRequest(`/api/kyc/submissions/${submissionId}/aadhaar`, { method: 'PUT', body: { aadhaar_number: aadhaarNumber } });
}

export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function getMyKyc() {
  return apiRequest('/api/kyc/me');
}

export function startSubmission() {
  return apiRequest('/api/kyc/submissions', { method: 'POST' });
}

export function uploadDocument(submissionId, documentType, file) {
  const query = new URLSearchParams({ document_type: documentType });
  return apiRequest(`/api/kyc/submissions/${submissionId}/documents?${query}`, { method: 'POST', file });
}

export function withdrawDocument(documentId) {
  return apiRequest(`/api/kyc/documents/${documentId}`, { method: 'DELETE' });
}

export function submitForReview(submissionId) {
  return apiRequest(`/api/kyc/submissions/${submissionId}/submit`, { method: 'POST' });
}

export function documentUrl(documentId) {
  return apiUrl(`/api/kyc/documents/${documentId}/file`);
}
