// Production-safety check: the built website must not contain the developer demo screens, the old
// fixed mobile code or the old browser-storage login flag, EVEN IF someone sets
// VITE_ENABLE_DEMO_PERSONAS=true while building for production.
//
//   npm run check:no-demo
//
// It builds into a temporary folder (your dist/ is not touched) and removes it afterwards.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const MUST_NOT_APPEAR = [
  'Development only: open sample screens',
  'Sample admin screens',
  'Sample seller screens',
  'Sample bidder screens',
  'Demo screens, not signed in',
  'Nothing here is authenticated',
  'salvex_demo_auth',
  '482910',
  'Instant Demo Persona',
  'Mobile OTP Login',
];
// Proof that the scan looks at the real application and is not passing on an empty build.
const MUST_APPEAR = ['Forgot password?', 'Create your Salvex account', '/api/auth/login'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|html|css|map)$/.test(name)) yield full;
  }
}

function buildAndScan(label, env) {
  const out = mkdtempSync(join(tmpdir(), 'salvex-prod-check-'));
  try {
    execFileSync(process.execPath, [viteBin, 'build', '--outDir', out, '--emptyOutDir'], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    const text = [...files(out)].map((f) => readFileSync(f, 'utf8')).join('\n');
    const leaked = MUST_NOT_APPEAR.filter((s) => text.includes(s));
    const missing = MUST_APPEAR.filter((s) => !text.includes(s));
    const ok = leaked.length === 0 && missing.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (leaked.length) console.log('   found in the built files (must not be): ' + JSON.stringify(leaked));
    if (missing.length) console.log('   expected application text missing (scan is not valid): ' + JSON.stringify(missing));
    return ok;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const results = [
  buildAndScan('default production build', {}),
  buildAndScan('production build with VITE_ENABLE_DEMO_PERSONAS=true set by mistake', { VITE_ENABLE_DEMO_PERSONAS: 'true' }),
];
process.exit(results.every(Boolean) ? 0 : 1);
