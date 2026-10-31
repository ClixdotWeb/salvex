// Public switches from the backend (GET /api/site-config). Loaded once per page load.
import { useEffect, useState } from 'react';
import { apiRequest } from './client';

let cached = null;

export function getSiteConfig() {
  if (!cached) {
    cached = apiRequest('/api/site-config', { notifyUnauthorized: false })
      .catch(() => { cached = null; return { online_payment: false, seller_accounts: false }; });
  }
  return cached;
}

/** { online_payment, seller_accounts } or null while loading. */
export function useSiteConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let alive = true;
    getSiteConfig().then((c) => { if (alive) setConfig(c); });
    return () => { alive = false; };
  }, []);
  return config;
}
