// Helpers for the REAL browser tests: real website + real API + local development database.
// Nothing here is mocked. Email and SMS have no real provider in development: codes are read from the
// developer outbox file the backend writes, so these tests prove the code checks, NOT delivery.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

const BACKEND = path.resolve('backend');
const PY = process.env.SALVEX_PYTHON || path.join(BACKEND, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const OUTBOX = path.join(BACKEND, '.dev_outbox', 'outbox.jsonl');

/** Rows from the local development database (read-only). */
export function db(sql, ...params) {
  const out = execFileSync(PY, ['../tests/real/dbq.py', sql, ...params.map(String)], { cwd: BACKEND, encoding: 'utf8' });
  return JSON.parse(out);
}

/** The newest 6-digit code the backend wrote to the developer outbox for an email or mobile. */
export function lastCode(to, after = 0) {
  expect.soft(existsSync(OUTBOX), 'developer outbox exists').toBe(true);
  const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').slice(after);
  const want = to.replace(/\s/g, '').toLowerCase();
  const hit = lines.map((l) => JSON.parse(l)).filter((m) => String(m.to).replace(/\s/g, '').toLowerCase() === want).pop();
  if (!hit) throw new Error(`no outbox message for ${to}`);
  return (hit.text || '').match(/\b(\d{6})\b/)[1];
}

export const outboxSize = () => (existsSync(OUTBOX) ? readFileSync(OUTBOX, 'utf8').trim().split('\n').length : 0);

/** Records every /api call of a page: method, path, status and (JSON) body. */
export function recordApi(page) {
  const calls = [];
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    calls.push({ method: res.request().method(), path: url.pathname + url.search, status: res.status(), body });
  });
  return {
    calls,
    last(method, pathPart) {
      return [...calls].reverse().find((c) => c.method === method && c.path.includes(pathPart));
    },
  };
}

export async function ready(page) {
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('.salvex-page-loader')).toHaveCount(0, { timeout: 20000 });
}

export async function go(page, url) {
  await page.goto(url);
  await ready(page);
}

export const stamp = () => Date.now().toString(36);

/** Click and wait for the matching API answer; returns { status, body }. */
export async function clickFor(page, locator, method, pathPart) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname.includes(pathPart), { timeout: 20000 }),
    locator.click(),
  ]);
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status(), body };
}

// ---------------------------------------------------------------- shared journeys
export const BUYER_PASSWORD = 'Maple-Tree-Walks-12';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** Registers a buyer through the real sign-up pages (SMS code, then the email code on the dashboard). */
export async function registerBuyer(page, tag) {
  const email = `real.${tag}.${stamp()}@example.com`.toLowerCase();   // the backend stores emails in lower case
  const mobile = `+91 9${String(Date.now()).slice(-9)}`;
  await go(page, '/register');
  await page.fill('#reg-name', `Real ${tag}`);
  await page.fill('#reg-email', email);
  await page.fill('#reg-password', BUYER_PASSWORD);
  await page.fill('#reg-mobile', mobile);
  expect((await clickFor(page, page.locator('form button[type="submit"]').first(), 'POST', '/api/auth/register')).status).toBe(201);
  await expect(page).toHaveURL(/\/verify-email/);
  await page.fill('#verify-email', email);
  await page.fill('#verify-code', lastCode(mobile));
  expect((await clickFor(page, page.locator('form button[type="submit"]').first(), 'POST', '/api/auth/verify-mobile')).status).toBe(200);
  await expect(page).toHaveURL(/\/dashboard/);
  const card = page.locator('section', { has: page.locator('#ev-title') });
  const before = outboxSize();
  await card.getByRole('button', { name: /Email me a code/ }).click();
  await card.locator('input[autocomplete="one-time-code"]').fill(lastCodeSoon(email, before));
  expect((await clickFor(page, card.getByRole('button', { name: /^Verify/ }), 'POST', '/api/auth/email/verify')).status).toBe(200);
  return { email, mobile, password: BUYER_PASSWORD };
}

function lastCodeSoon(to, after) {
  const end = Date.now() + 10000;
  for (;;) {
    try { return lastCode(to, after); } catch (e) { if (Date.now() > end) throw e; }
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']);
  }
}

export async function signIn(page, email, password) {
  await page.context().clearCookies();          // a signed-in visitor is sent away from /login
  await go(page, '/login');
  await page.fill('#login-email', email);
  await page.fill('#login-pass', password);
  return clickFor(page, page.locator('form button[type="submit"]').first(), 'POST', '/api/auth/login');
}

/** The verification administrator (created locally; credentials only in the environment, never in the repo). */
export const ADMIN = { email: process.env.SALVEX_REAL_ADMIN_EMAIL, password: process.env.SALVEX_REAL_ADMIN_PASSWORD };

/** A random Aadhaar number that passes the Verhoeff check (never a real person's number pattern is assumed). */
export function fakeAadhaar() {
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
    [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
    [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const inv = [0,4,3,2,1,5,6,7,8,9];
  const body = String(2 + Math.floor(Math.random() * 8)) + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  let c = 0;
  [...(body + '0')].reverse().forEach((ch, i) => { c = d[c][p[i % 8][Number(ch)]]; });
  return body + inv[c];
}

/** Pick an option in the site's themed drop-down. */
export async function choose(page, scope, option) {
  await scope.locator('.sx-select').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
