import React, { useState, useEffect, useLayoutEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import WhySalvex from './components/WhySalvex';
import AboutSection from './components/AboutSection';
import BuyerCta from './components/BuyerCta';
import Footer from './components/Footer';

// Information pages
import HowItWorksPage from './components/HowItWorksPage';
import BiddingRulesPage from './components/BiddingRulesPage';
import { pageTitle } from './utils/pageTitle';
import AboutPage from './components/AboutPage';
import ContactPage from './components/ContactPage';
import FaqPage from './components/FaqPage';
import LegalPage from './components/LegalPage';
import InsuranceServicePage from './components/services/InsuranceServicePage';
import SearchPage from './public/SearchPage';
import RecoveryServicePage from './components/services/RecoveryServicePage';
import DocumentationServicePage from './components/services/DocumentationServicePage';

// Accounts
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import VerifyEmailPage from './components/VerifyEmailPage';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import { useAuth } from './auth/useAuth';

// Real-data pages (everything below reads and writes the backend)
import AuctionsListPage, { HomeAuctions } from './public/AuctionsListPage';
import AuctionPage from './public/AuctionPage';
import { VehiclePage } from './public/VehiclesCatalogPage';
import SparePartsPage from './public/SparePartsPage';
import ReadyToLiftPage, { HomeReadyToLift } from './public/ReadyToLiftPage';
import BidderDashboard from './components/BidderDashboard';
import SellerDashboard, { SellPage } from './components/SellerDashboard';
import ReceiptPage from './components/ReceiptPage';
import AdminConsole from './admin/AdminConsole';
import ProtectedRoute from './components/ProtectedRoute';

// Static marketing content for the home page sections
import { howItWorksSteps, whySalvexFeatures } from './data/siteContent';

import './App.css';
import './components/SalvexAppComponents.css';
import { useScrollAnimations } from './hooks/useScrollAnimations';
import PageLoader from './components/ui/PageLoader';
import { MinimalFooter, MinimalHeader } from './components/MinimalChrome';
import { resetScrollToTop } from './utils/scrollHelper';

// Central Route-ID to URL Path Map (used by the navbar and footer)
export const ROUTE_MAP = {
  home: '/',
  vehicles: '/auctions/live',
  'live-auctions': '/auctions/live',
  'upcoming-auctions': '/auctions/upcoming',
  'ended-auctions': '/auctions/ended',
  'recently-added': '/auctions/upcoming',
  'spare-parts': '/spare-parts',
  'ready-to-lift': '/ready-to-lift',
  'service-insurance': '/services/insurance',
  'service-recovery': '/services/recovery',
  'service-documentation': '/services/documentation',
  'how-it-works': '/how-it-works',
  'bidding-rules': '/bidding-rules',
  about: '/about',
  contact: '/contact',
  faq: '/faq',
  'privacy-policy': '/legal/privacy',
  'terms-and-conditions': '/legal/terms',
  'refund-policy': '/legal/refund',
  'auction-policy': '/legal/auction',
  legal: '/legal',
  login: '/login',
  register: '/register',
  'list-your-vehicle': '/sell',
  dashboard: '/dashboard',
  'seller-dashboard': '/seller/dashboard',
  admin: '/admin',
};

const AUTH_PATHS = new Set(['/login', '/register', '/verify-email', '/forgot-password', '/reset-password']);
const APP_PATHS = new Set(['/dashboard', '/admin']);   // own top bar, no site header or footer

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [showPreloader, setShowPreloader] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);

  // GSAP ScrollTrigger smooth premium scroll enhancements (keyed to location.pathname)
  useScrollAnimations(location.pathname);

  // Scroll to the top on every route change
  useLayoutEffect(() => {
    resetScrollToTop();
    document.title = pageTitle(location.pathname);
  }, [location.pathname]);

  const getActiveSection = () => {
    const path = location.pathname;
    if (path === '/') return 'home';
    if (path.startsWith('/auctions/upcoming')) return 'upcoming-auctions';
    if (path.startsWith('/auctions')) return 'live-auctions';
    if (path.startsWith('/spare-parts')) return 'spare-parts';
    if (path.startsWith('/ready-to-lift')) return 'ready-to-lift';
    if (path.startsWith('/services') || path === '/sell') return 'services';
    if (path.startsWith('/how-it-works')) return 'how-it-works';
    if (path.startsWith('/about')) return 'about';
    if (path.startsWith('/contact')) return 'contact';
    return '';
  };

  const showToast = (msg, ms = 3500) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), ms);
  };

  // Ends the session on the server and clears this device. If the server could not confirm, say so.
  const handleLogout = async () => {
    const { serverRevoked } = await logout();
    if (serverRevoked) {
      showToast('You have been signed out.');
    } else {
      showToast(
        'You are signed out on this device, but we could not reach the server to end the session. On a shared computer, sign in and out again when you are back online.',
        9000
      );
    }
    navigate('/');
  };

  // "Sign out" inside the dashboards asks for the same sign-out as the top bar
  useEffect(() => {
    window.addEventListener('salvex:signout', handleLogout);
    return () => window.removeEventListener('salvex:signout', handleLogout);
  });

  const navigateTo = (route) => {
    if (route && (route.startsWith('/') || route.includes('?'))) {
      navigate(route);
      return;
    }
    navigate(ROUTE_MAP[route] || '/');
  };

  // Account pages get a minimal header and footer; the buyer dashboard has its own top bar and no footer.
  const layout = AUTH_PATHS.has(location.pathname) ? 'auth' : APP_PATHS.has(location.pathname) ? 'app' : 'site';

  return (
    <div className={`salvex-app-root layout-${layout}`}>
      {showPreloader && <PageLoader onLoadingComplete={() => setShowPreloader(false)} />}

      {layout === 'auth' && <MinimalHeader />}
      {layout === 'site' && <Navbar
        activeSection={getActiveSection()}
        onNavigate={(routeId) => navigateTo(routeId)}
        onOpenBidderModal={() => navigateTo('login')}
        onOpenSellerModal={() => navigateTo('list-your-vehicle')}
        onOpenSearchModal={() => navigate('/search')}
        onSearchSubmitQuery={() => navigate('/auctions/live')}
        onOpenRegister={() => navigate('/register')}
        onLogout={handleLogout}
      />}

      <main className="salvex-main-route-outlet" id="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <div className="salvex-home-view">
                <Hero onLiveAuctionsClick={() => navigateTo('live-auctions')} />
                <HomeReadyToLift />
                <HomeAuctions />
                <HowItWorks steps={howItWorksSteps} />
                <WhySalvex features={whySalvexFeatures} />
                <AboutSection onAboutClick={() => navigateTo('about')} />
                <BuyerCta onRegisterClick={() => navigateTo('register')} onExploreClick={() => navigateTo('vehicles')} />
              </div>
            }
          />

          {/* Vehicles and auctions (real data) */}
          {/* no "all vehicles" page: a vehicle is in an auction or Ready to Lift; old links go to the live auctions */}
          <Route path="/vehicles" element={<Navigate to="/auctions/live" replace />} />
          <Route path="/vehicles/recent" element={<Navigate to="/auctions/live" replace />} />
          <Route path="/vehicles/:id" element={<VehiclePage />} />
          <Route path="/auctions/live" element={<AuctionsListPage phase="live" />} />
          <Route path="/auctions/upcoming" element={<AuctionsListPage phase="upcoming" />} />
          <Route path="/auctions/ended" element={<AuctionsListPage phase="ended" />} />
          <Route path="/auctions/:id" element={<AuctionPage />} />
          <Route path="/spare-parts" element={<SparePartsPage />} />
          <Route path="/ready-to-lift" element={<ReadyToLiftPage />} />

          {/* Information pages */}
          <Route path="/how-it-works" element={<HowItWorksPage onRegisterClick={() => navigateTo('register')} onExploreClick={() => navigateTo('vehicles')} />} />
          <Route path="/bidding-rules" element={<BiddingRulesPage onRegisterClick={() => navigateTo('register')} />} />
          <Route path="/about" element={<AboutPage onExploreClick={() => navigateTo('vehicles')} onRegisterClick={() => navigateTo('register')} />} />
          <Route path="/contact" element={<ContactPage onShowToast={showToast} onNavigate={(route) => navigateTo(route)} onOpenRegister={() => navigateTo('register')} />} />
          <Route path="/faq" element={<FaqPage onContactClick={() => navigateTo('contact')} onRegisterClick={() => navigateTo('register')} />} />
          <Route path="/legal" element={<LegalPage initialTab="terms" />} />
          <Route path="/legal/terms" element={<LegalPage initialTab="terms" />} />
          <Route path="/legal/privacy" element={<LegalPage initialTab="privacy" />} />
          <Route path="/legal/refund" element={<LegalPage initialTab="refund" />} />
          <Route path="/legal/auction" element={<LegalPage initialTab="auction" />} />
          <Route path="/services/insurance" element={<InsuranceServicePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/services/recovery" element={<RecoveryServicePage />} />
          <Route path="/services/documentation" element={<DocumentationServicePage />} />

          {/* Accounts */}
          <Route path="/login" element={<LoginPage onShowToast={showToast} />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Signed-in areas */}
          <Route path="/sell" element={<SellPage />} />
          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['bidder', 'admin', 'seller']}><BidderDashboard /></ProtectedRoute>} />
          <Route path="/seller/dashboard" element={<ProtectedRoute allowedRoles={['seller', 'admin']}><SellerDashboard /></ProtectedRoute>} />
          <Route path="/orders/:id/receipt" element={<ProtectedRoute allowedRoles={['bidder', 'admin']}><ReceiptPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminConsole /></ProtectedRoute>} />

          {/* Old addresses: the real flow is Won -> Pay -> Receipt in the dashboard */}
          <Route path="/payment/:lotId" element={<Navigate to="/dashboard?tab=won" replace />} />
          <Route path="/lifting/:lotId" element={<Navigate to="/dashboard?tab=won" replace />} />

          <Route
            path="*"
            element={
              <div style={{ minHeight: '65vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '0.08em', color: '#075BFF', textTransform: 'uppercase', marginBottom: '8px' }}>Error 404</span>
                <h1 style={{ fontSize: '36px', lineHeight: '44px', fontWeight: '800', color: '#0B1220', marginBottom: '12px' }}>Page Not Found</h1>
                <p style={{ color: '#64748B', maxWidth: '460px', marginBottom: '28px', fontSize: '15px', lineHeight: '24px' }}>
                  The page you are looking for does not exist, has been removed, or the link has expired.
                </p>
                <Link to="/" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  Return to Homepage
                </Link>
              </div>
            }
          />
        </Routes>
      </main>

      {layout === 'auth' && <MinimalFooter />}
      {layout === 'site' && <Footer
        onNavigate={(routeId) => navigateTo(routeId)}
        onOpenBidderModal={() => navigateTo('login')}
        onOpenSellerModal={() => navigateTo('list-your-vehicle')}
        onOpenSavedModal={() => navigate('/dashboard')}
      />}

      {toastMessage && (
        <div className="salvex-toast-notification" role="status" aria-live="polite">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
