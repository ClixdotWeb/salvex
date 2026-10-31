import React from 'react';
import SalvexLogo from './SalvexLogo';
import { COMPANY, telLink, waLink } from '../config/company';
import {
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  ChevronRight,
  ShieldCheck,
  Share2,
  Globe,
  Rss,
  Camera,
  BadgeCheck,
  Clock
} from 'lucide-react';

export default function Footer({ onNavigate, onOpenBidderModal, onOpenSellerModal }) {
  const year = new Date().getFullYear();

  return (
    <footer className="salvex-footer" id="main-footer" aria-label="Site footer">


      {/* MAIN FOOTER BODY */}
      <div className="footer-body">
        <div className="footer-inner-container">

          {/* GRID */}
          <div className="footer-grid-main">

            {/* Brand Column */}
            <div className="footer-col footer-col-brand">
              <button className="footer-brand-logo-btn" onClick={() => onNavigate('home')} aria-label="Homepage">
                <SalvexLogo variant="dark" size="normal" />
              </button>
              <p className="footer-brand-tagline">Online Vehicle Auction Platform</p>
              <p className="footer-brand-desc">
                Discover, inspect, bid on and purchase salvage, damaged, used, and fleet vehicles through India's most transparent auction platform.
              </p>
              <div className="footer-trust-stack">
                <div className="footer-trust-item">
                  <ShieldCheck size={14} className="footer-trust-icon" />
                  <span>Verified payments</span>
                </div>
                <div className="footer-trust-item">
                  <BadgeCheck size={14} className="footer-trust-icon" />
                  <span>KYC-verified bidders</span>
                </div>
                <div className="footer-trust-item">
                  <Clock size={14} className="footer-trust-icon" />
                  <span>Server-timed live auctions</span>
                </div>
              </div>
              <div className="footer-social-row">
                <a href="#" className="footer-social-btn" aria-label="Twitter / X"><Share2 size={15} /></a>
                <a href="#" className="footer-social-btn" aria-label="LinkedIn"><Globe size={15} /></a>
                <a href="#" className="footer-social-btn" aria-label="YouTube"><Rss size={15} /></a>
                <a href="#" className="footer-social-btn footer-social-wa" aria-label="WhatsApp"><MessageCircle size={15} /></a>
                <a href="#" className="footer-social-btn" aria-label="Instagram"><Camera size={15} /></a>
              </div>
            </div>

            {/* Explore */}
            <div className="footer-col">
              <h4 className="footer-col-heading">Explore</h4>
              <ul className="footer-nav-list">
                {[
                  ['Live Auctions', 'live-auctions'],
                  ['Upcoming Auctions', 'upcoming-auctions'],
                  ['Ready to Lift', 'ready-to-lift'],
                  ['How It Works', 'how-it-works'],
                ].map(([label, route]) => (
                  <li key={route}>
                    <button className="footer-nav-link" onClick={() => onNavigate(route)}>
                      <ChevronRight size={13} className="footer-nav-chevron" />{label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Buyers */}
            <div className="footer-col">
              <h4 className="footer-col-heading">For Buyers</h4>
              <ul className="footer-nav-list">
                {[
                  ['Register as Bidder', 'register'],
                  ['Bidding Rules', 'bidding-rules'],
                  ['Payment & Settlement', 'payment'],
                  ['Vehicle Lifting', 'lifting'],
                  ['FAQ', 'faq'],
                ].map(([label, route]) => (
                  <li key={label}>
                    <button className="footer-nav-link" onClick={() => onNavigate(route)}>
                      <ChevronRight size={13} className="footer-nav-chevron" />{label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div className="footer-col">
              <h4 className="footer-col-heading">Company</h4>
              <ul className="footer-nav-list">
                {[
                  ['About Salvex', 'about'],
                  ['Bidding Rules', 'bidding-rules'],
                  ['FAQ', 'faq'],
                  ['Contact Us', 'contact'],
                ].map(([label, route]) => (
                  <li key={label}>
                    <button className="footer-nav-link" onClick={() => onNavigate(route)}>
                      <ChevronRight size={13} className="footer-nav-chevron" />{label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact + Legal */}
            <div className="footer-col">
              <h4 className="footer-col-heading">Contact Us</h4>
              <div className="footer-contact-list">
                {COMPANY.phone && (
                  <a href={telLink(COMPANY.phone)} className="footer-contact-item">
                    <span className="footer-contact-icon"><Phone size={13} /></span>
                    <span>{COMPANY.phone}</span>
                  </a>
                )}
                {COMPANY.email && (
                  <a href={`mailto:${COMPANY.email}`} className="footer-contact-item">
                    <span className="footer-contact-icon"><Mail size={13} /></span>
                    <span>{COMPANY.email}</span>
                  </a>
                )}
                {COMPANY.whatsapp && (
                  <a href={waLink(COMPANY.whatsapp)} target="_blank" rel="noopener noreferrer" className="footer-contact-item">
                    <span className="footer-contact-icon footer-wa-icon"><MessageCircle size={13} /></span>
                    <span>WhatsApp Support</span>
                  </a>
                )}
                {(COMPANY.city || COMPANY.address) && (
                  <div className="footer-contact-item">
                    <span className="footer-contact-icon"><MapPin size={13} /></span>
                    <span>{COMPANY.city || COMPANY.address}</span>
                  </div>
                )}
                <a href="/contact" className="footer-contact-item" onClick={(e) => { e.preventDefault(); onNavigate('contact'); }}>
                  <span className="footer-contact-icon"><Mail size={13} /></span>
                  <span>Send us a message</span>
                </a>
              </div>

              <h4 className="footer-col-heading" style={{ marginTop: '28px' }}>Legal</h4>
              <ul className="footer-nav-list">
                {[
                  ['Privacy Policy', 'privacy-policy'],
                  ['Terms & Conditions', 'terms-and-conditions'],
                  ['Refund Policy', 'refund-policy'],
                  ['Auction Policy', 'auction-policy'],
                ].map(([label, route]) => (
                  <li key={route}>
                    <button className="footer-nav-link" onClick={() => onNavigate(route)}>
                      <ChevronRight size={13} className="footer-nav-chevron" />{label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* BOTTOM BAR */}
          <div className="footer-bottom-bar">
            <div className="footer-bottom-left">
              <span>© {year} Salvex Auction. All rights reserved.</span>
            </div>
            <div className="footer-bottom-right">
              <span>Online Vehicle Auction Platform</span>
              <span className="footer-bottom-sep">•</span>
              <span>Salvage, Used & Damaged Vehicles</span>
              <button className="footer-admin-link" onClick={() => onNavigate('admin')}>
                Admin →
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

