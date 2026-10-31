import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import './ServiceLayout.css';

/**
 * Shared layout for the service pages (Recovery, Documentation): dark banner like the Contact page,
 * an intro block, feature cards with dark-blue icon tiles, and a dark-blue call to action.
 */
export default function ServiceLayout({ crumb, title, highlight, subtitle, badge, intro, features, cta }) {
  const BadgeIcon = badge.icon;
  const IntroIcon = intro.icon;
  return (
    <div className="sv-page">
      {/* Banner */}
      <section className="sv-banner">
        <div className="sv-banner-grid" aria-hidden="true" />
        <div className="sv-container sv-banner-inner">
          <div className="sv-banner-copy">
            <nav className="sv-crumbs" aria-label="Breadcrumb">
              <Link to="/">Home</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{crumb}</span>
            </nav>
            <span className="sv-badge"><BadgeIcon size={15} aria-hidden="true" /> {badge.text}</span>
            <h1 className="sv-title">{title} <span>{highlight}</span></h1>
            <p className="sv-subtitle">{subtitle}</p>
            <div className="sv-actions">
              <Link to="/contact" className="sv-btn sv-btn-light">
                {cta.button} <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <a href="#sv-features" className="sv-btn sv-btn-ghost">Learn more</a>
            </div>
          </div>
        </div>
      </section>

      {/* Intro + features */}
      <section className="sv-body" id="sv-features">
        <div className="sv-container">
          <div className="sv-intro">
            <span className="sv-icon"><IntroIcon size={24} aria-hidden="true" /></span>
            <div>
              <h2>{intro.title}</h2>
              <p>{intro.text}</p>
            </div>
          </div>

          <ul className="sv-cards">
            {features.map(({ icon: Icon, title: cardTitle, text }, i) => (
              <li key={cardTitle} className="sv-card">
                <div className="sv-card-top">
                  <span className="sv-icon sv-icon-soft"><Icon size={22} aria-hidden="true" /></span>
                  <span className="sv-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3>{cardTitle}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>

          <div className="sv-cta">
            <div>
              <h2>{cta.title}</h2>
              <p>{cta.text}</p>
            </div>
            <Link to="/contact" className="sv-btn sv-btn-light">
              {cta.button} <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
