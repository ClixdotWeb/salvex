// Browser tab title for each page. Detail pages (one auction or vehicle) can set a more specific one.
const SITE = 'Salvex Auction';
const HOME = 'Salvex Auction — Online Vehicle Auction Platform | Find. Bid. Win.';

const TITLES = {
  '/auctions/live': 'Live Auctions',
  '/auctions/upcoming': 'Upcoming Auctions',
  '/auctions/ended': 'Ended Auctions',
  '/spare-parts': 'Spare Parts',
  '/ready-to-lift': 'Ready to Lift',
  '/how-it-works': 'How It Works',
  '/bidding-rules': 'Bidding Rules',
  '/about': 'About Us',
  '/contact': 'Contact Us',
  '/faq': 'FAQ',
  '/legal': 'Terms & Conditions',
  '/legal/terms': 'Terms & Conditions',
  '/legal/privacy': 'Privacy Policy',
  '/legal/refund': 'Refund & EMD Policy',
  '/legal/auction': 'Auction Policy',
  '/services/insurance': 'Insurance Services',
  '/services/recovery': 'Vehicle Recovery',
  '/services/documentation': 'Documentation Assistance',
  '/search': 'Search',
  '/login': 'Sign In',
  '/register': 'Create Account',
  '/verify-email': 'Verify Email',
  '/forgot-password': 'Forgot Password',
  '/reset-password': 'Reset Password',
  '/sell': 'Sell With Us',
  '/dashboard': 'My Dashboard',
  '/seller/dashboard': 'Seller Dashboard',
  '/admin': 'Admin',
};

export function pageTitle(path) {
  if (path === '/') return HOME;
  let name = TITLES[path];
  if (!name && path.startsWith('/auctions/')) name = 'Auction';
  if (!name && path.startsWith('/vehicles/')) name = 'Vehicle';
  if (!name && path.startsWith('/orders/')) name = 'Receipt';
  return name ? `${name} | ${SITE}` : `Page Not Found | ${SITE}`;
}
