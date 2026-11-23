// The website's Content-Security-Policy (audit SEC-03), checked against the PRODUCTION build.
// The policy is read from deploy/security-headers.conf, the exact file nginx uses, and added to every
// page the browser loads. Any resource the policy would block shows up as a violation and fails the test.
// Run with: npm run check:csp   (builds the site, serves it with `vite preview`, API answers are mocked)
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from '../e2e/helpers/mockApi';

const conf = readFileSync(new URL('../../deploy/security-headers.conf', import.meta.url), 'utf8');
const CSP = conf.match(/add_header Content-Security-Policy "([^"]+)"/)[1];

async function withPolicy(page) {
  const violations = [];
  await page.exposeFunction('__cspViolation', (v) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__cspViolation(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`));
  });
  // Registered after mockApi, so it runs first: pages get the policy header, everything else falls through.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
  });
  return violations;
}

const PUBLIC = ['/', '/auctions/live', '/auctions/upcoming', '/spare-parts', '/ready-to-lift', '/how-it-works',
  '/bidding-rules', '/about', '/contact', '/faq', '/legal/terms', '/services/insurance', '/services/recovery',
  '/services/documentation', '/search?q=swift', '/login', '/register', '/forgot-password', '/no-such-page'];

test('the policy really is enforced (an inline script is blocked)', async ({ page }) => {
  await mockApi(page);
  const violations = await withPolicy(page);
  await open(page, '/');
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.append(s); });
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  await expect.poll(() => violations.length).toBeGreaterThan(0);
});

test('public pages load everything they need under the policy', async ({ page }) => {
  await mockApi(page);
  const violations = await withPolicy(page);
  for (const path of PUBLIC) {
    await open(page, path);
    await page.mouse.wheel(0, 4000);          // let scroll animations and lazy images run
    await page.waitForTimeout(600);
  }
  expect(violations).toEqual([]);
});

test('signed-in buyer dashboard and admin console load under the policy', async ({ page }) => {
  const api = await mockApi(page);
  const violations = await withPolicy(page);
  api.signIn(USERS.bidder);
  await open(page, '/dashboard');
  api.signIn(USERS.admin);
  await open(page, '/admin');
  for (const tab of ['auctions', 'kyc', 'users', 'results', 'reports']) await open(page, `/admin?tab=${tab}`);
  expect(violations).toEqual([]);
});

test('photo previews made in the browser (blob: and data: images) are allowed', async ({ page }) => {
  await mockApi(page);
  const violations = await withPolicy(page);
  await open(page, '/');
  const loaded = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = src; });
    return [await load(URL.createObjectURL(blob)), await load(canvas.toDataURL())];
  });
  expect(loaded).toEqual([true, true]);
  expect(violations).toEqual([]);
});
