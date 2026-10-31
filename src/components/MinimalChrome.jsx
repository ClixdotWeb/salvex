import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SalvexLogo from './SalvexLogo';
import './MinimalChrome.css';

const YEAR = new Date().getFullYear();

/**
 * Header and footer for the sign-in, registration, verification and password pages: just the logo,
 * a way back to the site and the legal links, so the form has the person's full attention.
 */
export function MinimalHeader() {
  return (
    <header className="mc-header">
      <div className="mc-inner">
        <Link to="/" className="mc-logo" aria-label="Salvex Auction home">
          <SalvexLogo variant="light" height={40} />
          <span>Salvex Auction</span>
        </Link>
        <Link to="/" className="mc-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to site
        </Link>
      </div>
    </header>
  );
}

export function MinimalFooter() {
  return (
    <footer className="mc-footer">
      <div className="mc-inner">
        <span>© {YEAR} Salvex Auction</span>
        <nav aria-label="Legal">
          <Link to="/legal/privacy">Privacy Policy</Link>
          <Link to="/legal/terms">Terms &amp; Conditions</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
