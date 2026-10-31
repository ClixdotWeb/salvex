// KYC as the client wants it: Aadhaar number + Aadhaar copy, PAN card and cancelled cheque before submitting.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const SID = '12121212-1212-4212-8212-121212121212';
const sub = (over = {}) => ({
  id: SID, status: 'draft', created_at: '2026-10-25T05:00:00Z', submitted_at: null, decided_at: null,
  documents: [], decisions: [], aadhaar_masked: null, aadhaar_number_needed: true,
  required_documents: ['aadhaar_card', 'pan_card', 'cancelled_cheque'], ...over,
});

test('the checklist shows what is still needed and the Aadhaar number is saved masked', async ({ page }) => {
  const api = await mockApi(page);
  api.signIn(USERS.bidder);
  let current = sub({
    documents: [{ id: 'd1', document_type: 'aadhaar_card', content_type: 'image/jpeg', size_bytes: 20000, uploaded_at: '2026-10-25T05:01:00Z', withdrawn_at: null }],
    required_documents: ['pan_card', 'cancelled_cheque'],
  });
  api.override('GET /api/kyc/me', () => api.json(200, { kyc_status: 'pending', submission: current }));
  api.override(`PUT /api/kyc/submissions/${SID}/aadhaar`, ({ body }) => {
    current = { ...current, aadhaar_masked: `XXXX XXXX ${body.aadhaar_number.slice(-4)}`, aadhaar_number_needed: false };
    return api.json(200, current);
  });

  await open(page, '/dashboard?tab=documents');
  const list = page.locator('.kyc-required-list');
  await expect(list.locator('li.done')).toHaveCount(1);                                       // Aadhaar card uploaded
  await expect(list).toContainText('Cancelled cheque');
  await expect(page.locator('.kyc-submit-bar')).toContainText('Still needed: Aadhaar number, PAN card, Cancelled cheque');
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();

  const input = page.getByLabel('Aadhaar number');
  await input.fill('2345 6789 0124');
  await expect(input).toHaveValue('2345 6789 0124');
  await page.locator('.kyc-aadhaar').getByRole('button', { name: 'Save' }).click();
  await expect(list.locator('li').first()).toContainText('XXXX XXXX 0124');
  expect(api.callsTo('PUT', `/api/kyc/submissions/${SID}/aadhaar`)[0].body).toEqual({ aadhaar_number: '234567890124' });
  await expect(page.locator('.kyc-submit-bar')).toContainText('Still needed: PAN card, Cancelled cheque');
});
