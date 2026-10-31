import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowUpRight,
  ArrowRight,
  Bike,
  Bus,
  Car,
  RefreshCw,
  ShieldCheck,
  ShieldPlus,
  Truck,
  MousePointerClick,
  Send,
  FileCheck2,
  Info
} from 'lucide-react';
import './InsuranceServicePage.css';

gsap.registerPlugin(ScrollTrigger);

// Client wording (Our Services → Vehicle Insurance)
const SERVICES = [
  { title: 'Car Insurance', icon: Car },
  { title: 'Two-Wheeler Insurance', icon: Bike },
  { title: 'Commercial Vehicle Insurance', icon: Truck },
  { title: 'Passenger Vehicle Insurance', icon: Bus },
  { title: 'Third-Party Insurance', icon: ShieldCheck },
  { title: 'Comprehensive Insurance', icon: ShieldPlus },
  { title: 'Insurance Policy Renewal', icon: RefreshCw }
];

// Built from the client's "How It Works" and "Bidding Rules" copy for insurance.
const PROCESS = [
  { icon: MousePointerClick, title: 'Choose a service', text: 'Explore our vehicle insurance services.' },
  { icon: Send, title: 'Submit an enquiry', text: 'Submit an enquiry or contact us for further assistance.' },
  { icon: FileCheck2, title: 'Policy issuance', text: 'Policy issuance is subject to insurer approval.' }
];

const pad = (n) => String(n).padStart(2, '0');

function usePageMotion(rootRef) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const mm = gsap.matchMedia(root);

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('.ins-hero-copy > *', { opacity: 0, y: 24, duration: 0.7, stagger: 0.08 })
        .from('.ins-hero-visual', { opacity: 0, y: 40, duration: 0.9 }, 0.15);

      const rise = (targets, trigger, extra = {}) =>
        gsap.from(targets, {
          opacity: 0,
          y: 28,
          duration: 0.6,
          stagger: 0.07,
          ease: 'power2.out',
          scrollTrigger: { trigger, start: 'top 85%', once: true },
          ...extra
        });

      rise('.ins-intro > *', '.ins-grid');
      gsap.from('.ins-card', { opacity: 0, duration: 0.6, stagger: 0.06, ease: 'power2.out', scrollTrigger: { trigger: '.ins-grid', start: 'top 85%', once: true } });
      rise('.ins-step', '.ins-process');
      rise('.ins-note', '.ins-note');
      rise('.ins-cta-inner > *', '.ins-cta');
    });

    return () => mm.revert();
  }, [rootRef]);
}

export default function InsuranceServicePage() {
  const rootRef = useRef(null);
  usePageMotion(rootRef);

  return (
    <div className="ins-page" ref={rootRef}>
      {/* Hero */}
      <section className="ins-hero">
        <div className="ins-hero-grid-bg" aria-hidden="true" />
        <div className="ins-container ins-hero-grid">
          <div className="ins-hero-copy">
            <nav className="ins-crumbs" aria-label="Breadcrumb">
              <Link to="/">Home</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Vehicle Insurance</span>
            </nav>
            <h1 className="ins-title">Vehicle Insurance <span>Services</span></h1>
            <p className="ins-subtitle">
              Get a new insurance policy or renew your existing vehicle insurance through our insurance service assistance.
            </p>
            <div className="ins-hero-actions">
              <Link to="/contact" className="ins-btn ins-btn-primary">
                Contact us <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#ins-services" className="ins-btn ins-btn-ghost">Our Services</a>
            </div>
          </div>

          <div className="ins-hero-visual" aria-hidden="true">
            <img src="/images/mercedes-sclass.jpg" alt="" />
            <span className="ins-glass"><ShieldCheck size={16} /> Vehicle Insurance</span>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="ins-services" id="ins-services" aria-labelledby="ins-services-title">
        <div className="ins-container">
          <ul className="ins-grid">
            {/* the heading is the first tile, so the 7 services fill a 4 x 2 grid */}
            <li className="ins-intro">
              <p className="ins-eyebrow">Vehicle Insurance</p>
              <h2 className="ins-heading" id="ins-services-title">Our Services</h2>
              <p className="ins-intro-text">Choose a service and send an enquiry. Our team will contact you.</p>
            </li>
            {SERVICES.map(({ title, icon: Icon }, i) => (
              <li key={title} className="ins-card">
                <div className="ins-card-top">
                  <span className="ins-icon"><Icon size={24} strokeWidth={1.8} aria-hidden="true" /></span>
                  <span className="ins-num" aria-hidden="true">{pad(i + 1)}</span>
                </div>
                <h3 className="ins-card-title">{title}</h3>
                <Link to="/contact" className="ins-card-link">
                  <span>Enquire <span className="ins-sr">about {title}</span></span>
                  <span className="ins-arrow"><ArrowUpRight size={18} aria-hidden="true" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Process + insurer note */}
      <section className="ins-process" aria-labelledby="ins-process-title">
        <div className="ins-container">
          <div className="ins-section-head">
            <p className="ins-eyebrow">How It Works</p>
            <h2 className="ins-heading" id="ins-process-title">Insurance Services</h2>
          </div>

          <ol className="ins-steps">
            {PROCESS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="ins-step">
                <div className="ins-step-rail" aria-hidden="true">
                  <span className="ins-step-dot"><Icon size={22} /></span>
                </div>
                <span className="ins-step-num">Step {pad(i + 1)}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>

          <p className="ins-note">
            <Info size={18} aria-hidden="true" />
            <span>
              Insurance coverage, premium, policy issuance, exclusions, and claims are subject to the terms and
              conditions of the relevant insurer. Policy issuance is subject to insurer approval.
            </span>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="ins-cta">
        <div className="ins-container">
          <div className="ins-cta-box">
            <div className="ins-cta-glow" aria-hidden="true" />
            <div className="ins-cta-inner">
              <div>
                <h2>Need help with vehicle insurance?</h2>
                <p>Get in touch with us for assistance with your vehicle insurance requirements.</p>
              </div>
              <Link to="/contact" className="ins-btn ins-btn-primary">
                Contact us <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
