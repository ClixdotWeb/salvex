// Orders for won auctions (backend/app/api/orders.py).
import { apiRequest } from './client';

export const listMyOrders = () => apiRequest('/api/orders/mine');
export const getOrder = (id) => apiRequest(`/api/orders/${id}`);
export const submitBankTransfer = (id, utr) => apiRequest(`/api/orders/${id}/bank-transfer`, { method: 'POST', body: { utr } });

export const ORDER_STATUS = {
  awaiting_payment: { label: 'Payment due', tone: 'amber' },
  payment_submitted: { label: 'Payment being verified', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  defaulted: { label: 'Not paid in time', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};
