// The signed-in user's own profile (backend/app/api/users.py). Only name, mobile and organization can change.
import { apiRequest } from './client';

export const getMe = () => apiRequest('/api/users/me');
export const updateMe = (changes) => apiRequest('/api/users/me', { method: 'PATCH', body: changes });
