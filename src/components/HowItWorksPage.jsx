import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  UserPlus,
  LayoutGrid,
  FileSearch,
  Gavel,
  BadgeCheck,
  CreditCard,
  Truck,
  Car,
  Wrench,
  ShieldCheck,
  LifeBuoy,
  ArrowRight,
  ArrowDownRight,
  Check,
  ScrollText
} from 'lucide-react';
import './HowItWorksPage.css';
import { BIDDING_RULES as RULES } from '../data/siteContent';

gsap.registerPlugin(ScrollTrigger);

const CATEGORIES = [
  {
    id: 'vehicles',
    title: 'Vehicle Auctions',
    icon: Car,
    to: '/auctions/live',
    text: 'Browse vehicles available through insurance companies, banks, NBFCs, and other sellers.'
  },
  {
    id: 'parts',
    title: 'Used Spare Parts',
    icon: Wrench,
    to: '/spare-parts',
    text: 'Explore available used spare parts, check the product details, condition, availability, and pricing, and contact the seller to proceed with your purchase.'
  },
  {
    id: 'insurance',
    title: 'Insurance Services',
    icon: ShieldCheck,
    to: '/services/insurance',
    text: 'Explore vehicle insurance services, including:',
    items: [
      'Car Insurance',
      'Two-Wheeler Insurance',
      'Commercial Vehicle Insurance',
      'Goods Vehicle Insurance',
      'Passenger Vehicle Insurance',
      'Third-Party Insurance',
      'Comprehensive Insurance',
      'Insurance Renewal'
    ]
  },
  {
    id: 'services',
    title: 'Vehicle-Related Services',
    icon: LifeBuoy,
    items: [
      { label: 'Vehicle Recovery Assistance', to: '/services/recovery' },
      { label: 'Vehicle Sale Assistance', to: '/sell' },
      { label: 'Documentation Assistance', to: '/services/documentation' }
    ]
  }
];

const STEPS = [
  {
    title: 'Register',
    icon: UserPlus,
    text: 'Create an id on Salvex Auction to explore available vehicles, spare parts, and services.'
  },
  {
    title: 'Explore Our Categories',
    icon: LayoutGrid,
    categories: true
  },
  {
    title: 'Review Details',
    icon: FileSearch,
    text: 'Carefully review the available vehicle or spare-part details, photographs, condition, documents, prices, and applicable terms before proceeding.'
  },
  {
    title: 'Place Your Bid or Submit an Enquiry',
    icon: Gavel,
    text: 'For vehicle auctions, place your bid according to the auction rules. For spare parts and insurance services, submit an enquiry or contact us for further assistance.'
  },
  {
    title: 'Confirmation',
    icon: BadgeCheck,
    text: 'For vehicle auctions, the successful bidder will receive instructions regarding the next steps. For spare parts and insurance services, the relevant purchase or service process will be communicated separately.'
  },
  {
    title: 'Complete Payment',
    icon: CreditCard,
    text: "Complete the applicable payment according to the seller's or service provider's confirmed terms and conditions."
  },
  {
    title: 'Complete Documentation & Collection',
    icon: Truck,
    text: 'Complete the necessary formalities. Successful vehicle bidders can arrange collection from the designated location within the specified pickup period. Spare-part delivery or collection and insurance policy issuance will follow the applicable arrangements.'
  }
];

const pad = (n) => String(n).padStart(2, '0');
const stepId = (i) => `hiw-step-${i + 1}`;

function CategoryCard({ cat }) {
  const Icon = cat.icon;
  return (
    <article className="hiw-cat">
      <div className="hiw-cat-head">
        <span className="hiw-icon hiw-icon-sm"><Icon size={18} aria-hidden="true" /></span>
        <h3>{cat.title}</h3>
      </div>
      {cat.text && <p>{cat.text}</p>}
      {cat.items && (
        <ul className={cat.id === 'insurance' ? 'hiw-chips' : 'hiw-links'}>
          {cat.items.map((item) =>
            typeof item === 'string' ? (
              <li key={item}>{item}</li>
            ) : (
              <li key={item.label}>
                <Link to={item.to}>
                  <span>{item.label}</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
            )
          )}
        </ul>
      )}
      {cat.to && (
        <Link to={cat.to} className="hiw-cat-more">
          Explore <span className="hiw-sr">{cat.title}</span> <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}

function useHowItWorksMotion(rootRef) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const q = (sel) => root.querySelectorAll(sel);
    const mm = gsap.matchMedia(root);

    mm.add(
      '(prefers-reduced-motion: no-preference)',
      () => {
        gsap.from('.hiw-banner-copy > *', {
          opacity: 0, y: 24, duration: 0.7, stagger: 0.08, ease: 'power3.out'
        });

        // the line fills exactly with the scroll (no catch-up animation)
        gsap.fromTo('.hiw-line-fill', { scaleY: 0 }, {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { trigger: '.hiw-zz', start: 'top 60%', end: 'bottom 60%', scrub: true }
        });

        q('.hiw-zz-step').forEach((step) => {
          ScrollTrigger.create({
            trigger: step,
            start: 'top 60%',
            onEnter: () => step.classList.add('is-active'),
            onLeaveBack: () => step.classList.remove('is-active')
          });
          const card = step.querySelector('.hiw-zz-card');
          gsap.from(card, {
            opacity: 0,
            y: 24,
            duration: 0.6,
            ease: 'power3.out',
            scrollTrigger: { trigger: step, start: 'top 85%', once: true }
          });
        });

        gsap.from(q('.hiw-rule'), {
          opacity: 0, y: 24, duration: 0.55, stagger: 0.04, ease: 'power2.out',
          scrollTrigger: { trigger: '.hiw-rules-grid', start: 'top 85%', once: true }
        });
        gsap.from('.hiw-cta-card', {
          opacity: 0, y: 30, duration: 0.7, ease: 'power3.out',
          scrollTrigger: { trigger: '.hiw-cta-card', start: 'top 88%', once: true }
        });

        return () => q('.hiw-zz-step.is-active').forEach((s) => s.classList.remove('is-active'));
      }
    );

    // content above can change height after loading: keep the scroll positions right
    let timer;
    let lastHeight = document.body.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (document.body.scrollHeight === lastHeight) return;
      lastHeight = document.body.scrollHeight;
      clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), 150);
    });
    observer.observe(document.body);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      mm.revert();
    };
  }, [rootRef]);
}

export default function HowItWorksPage({ onRegisterClick, onExploreClick }) {
  const rootRef = useRef(null);
  useHowItWorksMotion(rootRef);

  return (
    <div className="hiw-page" ref={rootRef}>
      {/* Banner */}
      <section className="hiw-banner">
        <div className="hiw-banner-grid" aria-hidden="true" />
        <div className="hiw-container hiw-banner-inner">
          <div className="hiw-banner-copy">
            <nav className="hiw-crumbs" aria-label="Breadcrumb">
              <Link to="/">Home</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">How It Works</span>
            </nav>
            <h1 className="hiw-title">How It <span>Works</span></h1>
            <p className="hiw-banner-text">From registration to collection, in seven steps.</p>
            <a href="#hiw-rules" className="hiw-banner-link">
              Bidding Rules &amp; Guidelines <ArrowDownRight size={18} aria-hidden="true" />
            </a>
          </div>

        </div>
      </section>

      {/* Steps */}
      <section className="hiw-steps">
        <div className="hiw-container">
          <div className="hiw-zz">
          <span className="hiw-line" aria-hidden="true"><span className="hiw-line-fill" /></span>
          <ol className="hiw-zz-list">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.title} id={stepId(i)} className="hiw-zz-step">
                  <span className="hiw-marker" aria-hidden="true">{pad(i + 1)}</span>
                  <div className="hiw-zz-card">
                    <div className="hiw-zz-head">
                      <span className="hiw-icon"><Icon size={22} aria-hidden="true" /></span>
                      <div>
                        <span className="hiw-zz-label">Step {pad(i + 1)}</span>
                        <h2>{step.title}</h2>
                      </div>
                    </div>
                    {step.text && <p className="hiw-zz-text">{step.text}</p>}
                    {step.categories && (
                      <div className="hiw-cats">
                        {CATEGORIES.map((cat) => <CategoryCard key={cat.id} cat={cat} />)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          </div>
        </div>
      </section>

      {/* Bidding rules */}
      <section className="hiw-rules" id="hiw-rules">
        <div className="hiw-container">
          <div className="hiw-rules-head">
            <span className="hiw-icon"><ScrollText size={22} aria-hidden="true" /></span>
            <h2>Bidding Rules &amp; Guidelines</h2>
          </div>
          <ol className="hiw-rules-grid">
            {RULES.map(([title, text], i) => (
              <li key={title} className="hiw-rule">
                <span className="hiw-rule-num">{pad(i + 1)}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing banner */}
      <section className="hiw-cta">
        <div className="hiw-container">
          <div className="hiw-cta-card">
            <div>
              <span className="hiw-cta-brand">Salvex Auction</span>
              <p className="hiw-cta-line">
                <span className="hiw-cta-check"><Check size={20} strokeWidth={3} aria-hidden="true" /></span>
                Buyers Can Pick Up Anytime
              </p>
            </div>
            <div className="hiw-cta-actions">
              <button type="button" className="hiw-btn hiw-btn-light" onClick={onRegisterClick}>
                Register <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="hiw-btn hiw-btn-ghost" onClick={onExploreClick}>
                Explore Vehicles
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
