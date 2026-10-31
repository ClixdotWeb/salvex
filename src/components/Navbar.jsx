import React, { useState, useEffect } from 'react';
import SalvexLogo from './SalvexLogo';
import {
  Search,
  User,
  Heart,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Truck,
  Headphones,
  Menu,
  X,
  PlusCircle,
} from 'lucide-react';
import './Navbar.css';
import { useAuth } from '../auth/useAuth';
import NotificationBell from './NotificationBell';
import AccountMenu from './AccountMenu';
import { homeForRole } from '../auth/roles';
import { DEMO_PERSONAS_ENABLED } from '../auth/demo';
import { COMPANY } from '../config/company';

export default function Navbar({
  activeSection = 'home',
  onNavigate,
  onOpenBidderModal,
  onOpenSellerModal,
  onOpenSearchModal,
  onSearchSubmitQuery,
  savedCount = 0,
  onOpenSavedModal,
  onOpenRegister,
  onLogout
}) {
  const { status: authStatus, user: authUser, demoRole } = useAuth();
  const accountHome = homeForRole(authUser?.role ?? demoRole);
  const firstName = (authUser?.name || '').trim().split(' ')[0];
  const initial = (firstName[0] || '?').toUpperCase();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [liveAuctionsDropdownOpen, setLiveAuctionsDropdownOpen] = useState(false);
  const [upcomingAuctionsDropdownOpen, setUpcomingAuctionsDropdownOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const [mobileLiveAuctionsOpen, setMobileLiveAuctionsOpen] = useState(false);
  const [mobileUpcomingAuctionsOpen, setMobileUpcomingAuctionsOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('#nav-wrap-live-auctions')) {
        setLiveAuctionsDropdownOpen(false);
      }
      if (!e.target.closest('#nav-wrap-upcoming-auctions')) {
        setUpcomingAuctionsDropdownOpen(false);
      }
      if (!e.target.closest('#nav-wrap-services')) {
        setServicesDropdownOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setLiveAuctionsDropdownOpen(false);
        setUpcomingAuctionsDropdownOpen(false);
        setServicesDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;

    const handleScroll = () => {
      const currentY = window.scrollY;
      setIsScrolled(currentY > 20);

      if (mobileMenuOpen) {
        setIsVisible(true);
        return;
      }

      if (currentY < 80) {
        setIsVisible(true);
      } else if (currentY > lastY + 12) {
        setIsVisible(false);
      } else if (currentY < lastY - 12) {
        setIsVisible(true);
      }

      lastY = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [mobileMenuOpen]);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'live-auctions', label: 'Live Auctions', isLive: true },
    { id: 'upcoming-auctions', label: 'Upcoming Auctions' },
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'how-it-works', label: 'How It Works' },
    { id: 'about', label: 'About' },
    { id: 'contact', label: 'Contact' }
  ];

  const handleLinkClick = (idOrPath) => {
    setIsScrolled(false);
    setIsVisible(true);
    setMobileMenuOpen(false);
    setLiveAuctionsDropdownOpen(false);
    setUpcomingAuctionsDropdownOpen(false);
    setServicesDropdownOpen(false);
    if (onNavigate) {
      onNavigate(idOrPath);
    } else {
      const el = document.getElementById(idOrPath);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearchSubmitQuery) {
      onSearchSubmitQuery(searchQuery);
    } else if (onNavigate) {
      onNavigate('vehicles');
    }
  };

  return (
    <>
      <header
        className={`salvex-master-navbar ${isScrolled ? 'navbar-scrolled' : ''} ${!isVisible ? 'navbar-hidden' : ''}`}
        id="main-navbar"
      >
        {/* ==================================================================
            TIER 0: CRIMSON RED ANNOUNCEMENT BAR
            ================================================================== */}
        <div className="navbar-announcement-bar">
          <div className="salvex-nav-container announcement-container">
            {/* Desktop Left Blank Spacer */}
            <div className="announcement-left announcement-desktop" />

            {/* Desktop Center */}
            <div className="announcement-center announcement-desktop">
              <Truck size={13} className="announcement-icon" />
              <span>New Arrivals Added Daily &nbsp;|&nbsp; <strong>Register Now to Start Bidding</strong></span>
            </div>

            {/* Desktop Right */}
            <div className="announcement-right announcement-desktop">
              <Headphones size={13} className="announcement-icon" />
              {COMPANY.phone ? <span>Need Help? <strong>{COMPANY.phone}</strong></span> : <span>Need Help? <strong>Contact us</strong></span>}
            </div>

            {/* Mobile Announcement Banner (425px - 320px) matching reference */}
            <div
              className="announcement-mobile-banner"
              onClick={authUser ? () => onNavigate && onNavigate(accountHome) : (onOpenRegister || onOpenBidderModal)}
              role="button"
              tabIndex={0}
            >
              <div className="announcement-mobile-content">
                <Truck size={14} className="announcement-icon" />
                <span className="announcement-mobile-text">
                  New Arrivals Added Daily &nbsp;|&nbsp; <strong>Register Now to Start Bidding</strong>
                </span>
              </div>
              <ChevronRight size={15} strokeWidth={2.4} className="announcement-mobile-chevron" />
            </div>
          </div>
        </div>

        {/* ==================================================================
            TIER 1: MAIN BRAND HEADER (WHITE)
            ================================================================== */}
        <div className="navbar-middle-row">
          <div className="salvex-nav-container middle-row-container">
            {/* MOBILE ONLY: Left Hamburger Menu Button */}
            <button
              type="button"
              className="navbar-mobile-hamburger-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              id="mobile-nav-hamburger"
            >
              {mobileMenuOpen ? <X size={23} strokeWidth={2.2} /> : <Menu size={23} strokeWidth={2.2} />}
            </button>

            {/* DESKTOP ONLY: keeps the space on the left (search now sits on the right) */}
            <div className="navbar-left-actions" />

            {/* CENTER: Salvex Auction Brand Logo */}
            <div
              className="navbar-center-brand"
              onClick={() => handleLinkClick('home')}
              role="button"
              tabIndex={0}
              title="Salvex Auction Home"
            >
              <SalvexLogo variant="light" height={64} src="/images/lg.png" />
            </div>

            {/* DESKTOP ONLY: List Your Vehicle + Wishlist + Login + Register CTA */}
            <div className="navbar-middle-actions">
              {/* Search */}
              <button
                type="button"
                className="navbar-action-icon-btn nav-round"
                onClick={onOpenSearchModal}
                title="Search vehicles"
                aria-label="Search"
                id="navbar-search-btn-left"
              >
                <Search size={21} strokeWidth={2.2} />
              </button>

              {/* Notifications (signed-in users) */}
              {authUser && <NotificationBell />}

              {authStatus === 'loading' ? null : authUser ? (
                /* Signed in: avatar menu (who you are, dashboard, profile, sign out) */
                <AccountMenu user={authUser} home={accountHome} onLogout={onLogout} />
              ) : (
                <>
                  {DEMO_PERSONAS_ENABLED && demoRole && <span className="navbar-demo-badge">Demo screens, not signed in</span>}

                  {/* User Login Icon */}
                  <button
                    type="button"
                    className="navbar-action-icon-btn nav-round"
                    onClick={onOpenBidderModal}
                    title="Account Login"
                    aria-label="Account Login"
                  >
                    <User size={21} strokeWidth={2} />
                  </button>

                  {/* Register button */}
                  <button
                    type="button"
                    className="btn-register-red"
                    onClick={onOpenRegister || onOpenBidderModal}
                    id="nav-register-cta"
                  >
                    <span>Register</span>
                    <ArrowRight size={15} strokeWidth={2.2} />
                  </button>
                </>
              )}
            </div>

            {/* MOBILE ONLY (425px - 320px): Right Controls: Search Box Button + Red User Box Button */}
            <div className="navbar-mobile-controls">
              {/* Search Box Button */}
              <button
                type="button"
                className="mobile-search-box-btn"
                onClick={onOpenSearchModal}
                aria-label="Search Vehicles"
                title="Search"
                id="mobile-search-btn"
              >
                <Search size={18} strokeWidth={2.2} />
              </button>

              {/* Red User Box Button */}
              <button
                type="button"
                className={`mobile-user-box-btn${authUser ? ' is-avatar' : ''}`}
                onClick={authUser ? () => onNavigate && onNavigate(accountHome) : onOpenBidderModal}
                aria-label={authUser ? `My account (${firstName})` : 'Account Login'}
                title={authUser ? authUser.name : 'Account Login'}
                id="mobile-user-btn"
              >
                {authUser ? <span className="mobile-user-initial">{initial}</span> : <User size={19} strokeWidth={2.2} />}
              </button>
            </div>
          </div>
        </div>

        {/* ==================================================================
            TIER 2: NAVIGATION LINKS BAR (WHITE WITH BOTTOM BORDER)
            ================================================================== */}
        <div className="navbar-links-row">
          <div className="salvex-nav-container links-row-container">
            <nav className="navbar-links-center" aria-label="Main Navigation">
              {/* Home */}
              <button
                type="button"
                onClick={() => handleLinkClick('home')}
                className={`nav-link-btn ${activeSection === 'home' ? 'nav-link-active' : ''}`}
                id="nav-link-home"
              >
                <span>Home</span>
                {activeSection === 'home' && <span className="nav-bottom-indicator" />}
              </button>

              {/* Live Auctions Dropdown */}
              <div
                className="navbar-dropdown-wrap"
                id="nav-wrap-live-auctions"
                onMouseEnter={() => setLiveAuctionsDropdownOpen(true)}
                onMouseLeave={() => setLiveAuctionsDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => handleLinkClick('/auctions/live')}
                  className={`nav-link-btn ${activeSection === 'live-auctions' ? 'nav-link-active' : ''}`}
                  id="nav-link-live-auctions"
                  aria-expanded={liveAuctionsDropdownOpen}
                  aria-haspopup="true"
                >
                  <span>Live Auctions</span>
                  <span className="nav-live-capsule">LIVE</span>
                  <ChevronDown size={14} className={`dropdown-chevron ${liveAuctionsDropdownOpen ? 'open' : ''}`} />
                  {activeSection === 'live-auctions' && <span className="nav-bottom-indicator" />}
                </button>

                {liveAuctionsDropdownOpen && (
                  <div className="navbar-dropdown-menu" role="menu">
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/live?category=insurance')}
                      id="nav-subitem-live-insurance"
                    >
                      Insurance Auctions
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/live?category=bank-nbfc')}
                      id="nav-subitem-live-bank"
                    >
                      Bank / NBFC Auctions
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/live?category=used-vehicle')}
                      id="nav-subitem-live-used"
                    >
                      Used Vehicle Auctions
                    </button>
                  </div>
                )}
              </div>

              {/* Upcoming Auctions Dropdown */}
              <div
                className="navbar-dropdown-wrap"
                id="nav-wrap-upcoming-auctions"
                onMouseEnter={() => setUpcomingAuctionsDropdownOpen(true)}
                onMouseLeave={() => setUpcomingAuctionsDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => handleLinkClick('/auctions/upcoming')}
                  className={`nav-link-btn ${activeSection === 'upcoming-auctions' ? 'nav-link-active' : ''}`}
                  id="nav-link-upcoming-auctions"
                  aria-expanded={upcomingAuctionsDropdownOpen}
                  aria-haspopup="true"
                >
                  <span>Upcoming Auctions</span>
                  <ChevronDown size={14} className={`dropdown-chevron ${upcomingAuctionsDropdownOpen ? 'open' : ''}`} />
                  {activeSection === 'upcoming-auctions' && <span className="nav-bottom-indicator" />}
                </button>

                {upcomingAuctionsDropdownOpen && (
                  <div className="navbar-dropdown-menu" role="menu">
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/upcoming?category=insurance')}
                      id="nav-subitem-upcoming-insurance"
                    >
                      Insurance Auctions
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/upcoming?category=bank-nbfc')}
                      id="nav-subitem-upcoming-bank"
                    >
                      Bank / NBFC Auctions
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/auctions/upcoming?category=used-vehicle')}
                      id="nav-subitem-upcoming-used"
                    >
                      Used Vehicle Auctions
                    </button>
                  </div>
                )}
              </div>

              {/* Ready to Lift */}
              <button
                type="button"
                onClick={() => handleLinkClick('ready-to-lift')}
                className={`nav-link-btn ${activeSection === 'ready-to-lift' ? 'nav-link-active' : ''}`}
                id="nav-link-ready-to-lift"
              >
                <span>Ready to Lift</span><span className="nav-rtl-dot" aria-hidden="true" />
                {activeSection === 'ready-to-lift' && <span className="nav-bottom-indicator" />}
              </button>

              {/* Spare Parts */}
              <button
                type="button"
                onClick={() => handleLinkClick('spare-parts')}
                className={`nav-link-btn ${activeSection === 'spare-parts' ? 'nav-link-active' : ''}`}
                id="nav-link-spare-parts"
              >
                <span>Spare Parts</span>
                {activeSection === 'spare-parts' && <span className="nav-bottom-indicator" />}
              </button>

              {/* Our Services Dropdown */}
              <div
                className="navbar-dropdown-wrap"
                id="nav-wrap-services"
                onMouseEnter={() => setServicesDropdownOpen(true)}
                onMouseLeave={() => setServicesDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => setServicesDropdownOpen((prev) => !prev)}
                  className={`nav-link-btn ${activeSection === 'services' ? 'nav-link-active' : ''}`}
                  id="nav-link-services"
                  aria-expanded={servicesDropdownOpen}
                  aria-haspopup="true"
                >
                  <span>Our Services</span>
                  <ChevronDown size={14} className={`dropdown-chevron ${servicesDropdownOpen ? 'open' : ''}`} />
                  {activeSection === 'services' && <span className="nav-bottom-indicator" />}
                </button>

                {servicesDropdownOpen && (
                  <div className="navbar-dropdown-menu" role="menu">
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/services/insurance')}
                      id="nav-service-insurance"
                    >
                      Vehicle Insurance
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/services/recovery')}
                      id="nav-service-recovery"
                    >
                      Recovery Vehicle Booking
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleLinkClick('/services/documentation')}
                      id="nav-service-documentation"
                    >
                      Vehicle Documentation Assistance
                    </button>
                  </div>
                )}
              </div>

              {/* How It Works */}
              <button
                type="button"
                onClick={() => handleLinkClick('how-it-works')}
                className={`nav-link-btn ${activeSection === 'how-it-works' ? 'nav-link-active' : ''}`}
                id="nav-link-how-it-works"
              >
                <span>How It Works</span>
                {activeSection === 'how-it-works' && <span className="nav-bottom-indicator" />}
              </button>

              {/* About */}
              <button
                type="button"
                onClick={() => handleLinkClick('about')}
                className={`nav-link-btn ${activeSection === 'about' ? 'nav-link-active' : ''}`}
                id="nav-link-about"
              >
                <span>About</span>
                {activeSection === 'about' && <span className="nav-bottom-indicator" />}
              </button>

              {/* Contact */}
              <button
                type="button"
                onClick={() => handleLinkClick('contact')}
                className={`nav-link-btn ${activeSection === 'contact' ? 'nav-link-active' : ''}`}
                id="nav-link-contact"
              >
                <span>Contact</span>
                {activeSection === 'contact' && <span className="nav-bottom-indicator" />}
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ==================================================================
          MOBILE SLIDE-OUT DRAWER
          ================================================================== */}
      <div
        className={`mobile-menu-backdrop ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside
        className={`mobile-drawer ${mobileMenuOpen ? 'mobile-drawer-open' : ''}`}
        aria-label="Mobile Navigation"
      >
        <div className="mobile-drawer-header">
          <SalvexLogo variant="dark" height={34} />
          <button
            type="button"
            className="mobile-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mobile-drawer-body">
          <nav className="mobile-nav-list">
            {/* Home */}
            <button
              type="button"
              onClick={() => handleLinkClick('home')}
              className={`mobile-nav-item ${activeSection === 'home' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-home"
            >
              <span className="mobile-nav-label-wrap">
                <span>Home</span>
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>

            {/* Live Auctions Accordion */}
            <div className="mobile-accordion-group">
              <button
                type="button"
                className={`mobile-nav-item ${activeSection === 'live-auctions' ? 'mobile-nav-active' : ''}`}
                onClick={() => setMobileLiveAuctionsOpen((prev) => !prev)}
                id="mobile-nav-link-live-auctions"
              >
                <span className="mobile-nav-label-wrap">
                  <span>Live Auctions</span>
                  <span className="nav-live-capsule" style={{ marginLeft: '6px' }}>LIVE</span>
                </span>
                <ChevronDown size={14} className={`dropdown-chevron ${mobileLiveAuctionsOpen ? 'open' : ''}`} />
              </button>
              {mobileLiveAuctionsOpen && (
                <div className="mobile-sub-menu">
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/live?category=insurance')}
                    id="mobile-nav-subitem-live-insurance"
                  >
                    Insurance Auctions
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/live?category=bank-nbfc')}
                    id="mobile-nav-subitem-live-bank"
                  >
                    Bank / NBFC Auctions
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/live?category=used-vehicle')}
                    id="mobile-nav-subitem-live-used"
                  >
                    Used Vehicle Auctions
                  </button>
                </div>
              )}
            </div>

            {/* Upcoming Auctions Accordion */}
            <div className="mobile-accordion-group">
              <button
                type="button"
                className={`mobile-nav-item ${activeSection === 'upcoming-auctions' ? 'mobile-nav-active' : ''}`}
                onClick={() => setMobileUpcomingAuctionsOpen((prev) => !prev)}
                id="mobile-nav-link-upcoming-auctions"
              >
                <span className="mobile-nav-label-wrap">
                  <span>Upcoming Auctions</span>
                </span>
                <ChevronDown size={14} className={`dropdown-chevron ${mobileUpcomingAuctionsOpen ? 'open' : ''}`} />
              </button>
              {mobileUpcomingAuctionsOpen && (
                <div className="mobile-sub-menu">
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/upcoming?category=insurance')}
                    id="mobile-nav-subitem-upcoming-insurance"
                  >
                    Insurance Auctions
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/upcoming?category=bank-nbfc')}
                    id="mobile-nav-subitem-upcoming-bank"
                  >
                    Bank / NBFC Auctions
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/auctions/upcoming?category=used-vehicle')}
                    id="mobile-nav-subitem-upcoming-used"
                  >
                    Used Vehicle Auctions
                  </button>
                </div>
              )}
            </div>

            {/* Ready to Lift */}
            <button
              type="button"
              onClick={() => handleLinkClick('ready-to-lift')}
              className={`mobile-nav-item ${activeSection === 'ready-to-lift' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-ready-to-lift"
            >
              <span className="mobile-nav-label-wrap">
                <span>Ready to Lift</span><span className="nav-rtl-dot" aria-hidden="true" />
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>

            {/* Spare Parts */}
            <button
              type="button"
              onClick={() => handleLinkClick('spare-parts')}
              className={`mobile-nav-item ${activeSection === 'spare-parts' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-spare-parts"
            >
              <span className="mobile-nav-label-wrap">
                <span>Spare Parts</span>
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>

            {/* Our Services Accordion */}
            <div className="mobile-accordion-group">
              <button
                type="button"
                className={`mobile-nav-item ${activeSection === 'services' ? 'mobile-nav-active' : ''}`}
                onClick={() => setMobileServicesOpen((prev) => !prev)}
                id="mobile-nav-link-services"
              >
                <span className="mobile-nav-label-wrap">
                  <span>Our Services</span>
                </span>
                <ChevronDown size={14} className={`dropdown-chevron ${mobileServicesOpen ? 'open' : ''}`} />
              </button>
              {mobileServicesOpen && (
                <div className="mobile-sub-menu">
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/services/insurance')}
                    id="mobile-nav-service-insurance"
                  >
                    Vehicle Insurance
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/services/recovery')}
                    id="mobile-nav-service-recovery"
                  >
                    Recovery Vehicle Booking
                  </button>
                  <button
                    type="button"
                    className="mobile-sub-item"
                    onClick={() => handleLinkClick('/services/documentation')}
                    id="mobile-nav-service-documentation"
                  >
                    Vehicle Documentation Assistance
                  </button>
                </div>
              )}
            </div>


            {/* How It Works */}
            <button
              type="button"
              onClick={() => handleLinkClick('how-it-works')}
              className={`mobile-nav-item ${activeSection === 'how-it-works' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-how-it-works"
            >
              <span className="mobile-nav-label-wrap">
                <span>How It Works</span>
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>

            {/* About */}
            <button
              type="button"
              onClick={() => handleLinkClick('about')}
              className={`mobile-nav-item ${activeSection === 'about' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-about"
            >
              <span className="mobile-nav-label-wrap">
                <span>About</span>
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>

            {/* Contact */}
            <button
              type="button"
              onClick={() => handleLinkClick('contact')}
              className={`mobile-nav-item ${activeSection === 'contact' ? 'mobile-nav-active' : ''}`}
              id="mobile-nav-link-contact"
            >
              <span className="mobile-nav-label-wrap">
                <span>Contact</span>
              </span>
              <ArrowRight size={14} className="mobile-nav-chevron" />
            </button>
          </nav>

          <div className="mobile-drawer-divider" />

          <div className="mobile-drawer-ctas">
            {authUser ? (
              <>
                <button
                  type="button"
                  className="btn-drawer-outline"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (onNavigate) onNavigate(accountHome);
                  }}
                >
                  <User size={15} />
                  <span>My account ({authUser.name.split(' ')[0]})</span>
                </button>

                <button
                  type="button"
                  className="btn-register-red w-full"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (onLogout) onLogout();
                  }}
                >
                  <span>Sign out</span>
                  <ArrowRight size={15} />
                </button>
              </>
            ) : authStatus === 'loading' ? null : (
              <>
                <button
                  type="button"
                  className="btn-drawer-outline"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (onOpenBidderModal) onOpenBidderModal();
                  }}
                >
                  <User size={15} />
                  <span>Login</span>
                </button>

                <button
                  type="button"
                  className="btn-register-red w-full"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (onOpenRegister) onOpenRegister();
                    else if (onOpenBidderModal) onOpenBidderModal();
                  }}
                >
                  <span>Register</span>
                  <ArrowRight size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

