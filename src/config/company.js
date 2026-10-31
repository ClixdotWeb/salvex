// Company contact details shown on the website. Set them in the frontend environment (.env / Vercel / Coolify):
//   VITE_COMPANY_PHONE=+91 98xxx xxxxx   VITE_COMPANY_WHATSAPP=+91 98xxx xxxxx   VITE_COMPANY_EMAIL=support@...
//   VITE_COMPANY_ADDRESS=Full office address   VITE_COMPANY_CITY=City, State
// Anything left empty is hidden on the site (no fake numbers are ever shown).
const env = import.meta.env;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export const COMPANY = {
  phone: clean(env.VITE_COMPANY_PHONE),
  whatsapp: clean(env.VITE_COMPANY_WHATSAPP),
  email: clean(env.VITE_COMPANY_EMAIL),
  address: clean(env.VITE_COMPANY_ADDRESS),
  city: clean(env.VITE_COMPANY_CITY),
};

export const telLink = (n) => `tel:${n.replace(/[^0-9+]/g, '')}`;
export const waLink = (n) => `https://wa.me/${n.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hello Salvex Auction Support')}`;
export const mapLink = (q) => `https://maps.google.com/?q=${encodeURIComponent(q)}`;
