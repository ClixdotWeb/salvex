import React from 'react';
import {
  CheckCircle2,
  Gavel,
  Car,
  FileCheck,
  ArrowRight,
  ShieldCheck,
  Users,
  Warehouse
} from 'lucide-react';
import './AboutPage.css';

const STATS = [
  { value: 'KYC', label: 'Verified Bidders', sub: 'Identity checked before anyone can bid' },
  { value: 'Live', label: 'Online Auctions', sub: 'Server-timed, open bidding' },
  { value: '1:1', label: 'Team Support', sub: 'Our team contacts every winner' },
  { value: '100%', label: 'Reviewed Listings', sub: 'Every vehicle checked before auction' },
];

const ASSET_CATEGORIES = [
  {
    num: '01',
    title: 'Salvage Vehicles',
    desc: 'Insurance total-loss and accident recovery vehicles ideal for certified rebuilders, dismantlers, and component recyclers.',
    icon: Car,
  },
  {
    num: '02',
    title: 'Damaged Vehicles',
    desc: 'Mechanically sound or repairable body-damage lots with comprehensive 150-point diagnostic damage reports.',
    icon: FileCheck,
  },
  {
    num: '03',
    title: 'Used Vehicles',
    desc: 'Clean-title, inspected pre-owned passenger and commercial fleets ready for immediate road use and RTO title transfer.',
    icon: CheckCircle2,
  },
  {
    num: '04',
    title: 'Auction Vehicles',
    desc: 'Bank repossessions, institutional fleet roll-offs, and luxury exotics auctioned under competitive bidding timelines.',
    icon: Gavel,
  },
];

const CONNECT = [
  ['Vehicle Owners & Individual Consignors:', 'Access liquid national buyer demand without middlemen delays or price erosion.'],
  ['Automotive Dealers & Fleet Operators:', 'Efficiently procure high-yield commercial and passenger vehicle stock with verifiable title trails.'],
  ['Independent Buyers & Rebuilders:', 'Acquire salvage, project, and clear-title used vehicles with detailed diagnostic condition checklists.'],
  ['Professional Bidders:', 'Participate in scheduled live auctions with anti-sniping protection and auction terminal controls.'],
];

const SOURCES = [
  ['Scheduled Commercial Banks:', 'Court-authorized loan repossession and asset recovery portfolios.'],
  ['Non-Banking Financial Companies (NBFCs):', 'Corporate lease returns, commercial vehicle portfolios, and inventory liquidations.'],
  ['General Insurance Companies:', 'Constructive total loss (CTL), salvage recoveries, and theft-recovered vehicles.'],
  ['Corporate Fleets & Verified Consumers:', 'High-grade pre-owned vehicles with complete digital service history.'],
];

const OFFERS = [
  'Online Vehicle Auctions',
  'Salvage & Damaged Vehicle Listings',
  'Used Vehicle Fleet Auctions',
  'Transparent Real-Time Bidding',
  'Spare Parts & Part Requests',
  'Online KYC Verification',
  'Live & Scheduled Bidding Timelines',
  'Personal Support for Every Winner',
];

function BridgeCard({ badge, icon: Icon, title, lead, items }) {
  return (
    <article className="ab-glass ab-bridge-card">
      <div className="ab-bridge-head">
        <span className="ab-icon"><Icon size={20} aria-hidden="true" /></span>
        <span className="ab-badge">{badge}</span>
      </div>
      <h2>{title}</h2>
      <p className="ab-lead">{lead}</p>
      <ul className="ab-bullets">
        {items.map(([strong, text]) => (
          <li key={strong}><strong>{strong}</strong> {text}</li>
        ))}
      </ul>
    </article>
  );
}

export default function AboutPage({ onExploreClick, onRegisterClick }) {
  return (
    <div className="ab-page">
      <div className="ab-grid-bg" aria-hidden="true" />

      {/* Hero */}
      <section className="ab-hero">
        <div className="ab-glow ab-glow-a" aria-hidden="true" />
        <div className="ab-container ab-hero-grid">
          <div className="ab-hero-copy">
            <span className="ab-eyebrow"><span className="ab-dot" aria-hidden="true" /> About Salvex</span>
            <h1 className="ab-title">
              Making Vehicle Auctions <span>Simple, Transparent</span> &amp; Accessible.
            </h1>
            <p className="ab-hero-text">
              Salvex Auction is an online vehicle auction platform designed to make the process of discovering, bidding, and purchasing vehicles simple, transparent, and convenient.
            </p>
            <div className="ab-actions">
              <button type="button" className="ab-btn ab-btn-primary" onClick={onExploreClick}>
                Explore Live Auctions <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="ab-btn ab-btn-glass" onClick={onRegisterClick}>
                Register
              </button>
            </div>
          </div>

          <div className="ab-hero-visual">
            <div className="ab-photo">
              <img
                src="https://i.pinimg.com/736x/8e/f5/c5/8ef5c5059bc189b20b3e6ef4f4cfbb98.jpg"
                alt="Salvex Auction - Verified Inventory"
                loading="eager"
              />
            </div>
            <div className="ab-float ab-float-top">
              <ShieldCheck size={18} aria-hidden="true" />
              <span><strong>KYC</strong> Verified Bidders</span>
            </div>
            <div className="ab-float ab-float-bottom">
              <span className="ab-live-dot" aria-hidden="true" />
              <span><strong>Live</strong> Online Auctions</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="ab-section ab-stats-wrap">
        <div className="ab-container">
          <div className="ab-glass ab-stats">
            {STATS.map((stat) => (
              <div key={stat.label} className="ab-stat">
                <div className="ab-stat-value">{stat.value}</div>
                <div className="ab-stat-label">{stat.label}</div>
                <div className="ab-stat-sub">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who we connect + inventory sources */}
      <section className="ab-section">
        <div className="ab-container ab-bridge">
          <BridgeCard
            badge="THE MARKETPLACE BRIDGE"
            icon={Users}
            title="Who We Connect"
            lead="Salvex Auction operates an enterprise-grade digital exchange bringing together verified market participants in an authenticated, regulated bidding environment:"
            items={CONNECT}
          />
          <BridgeCard
            badge="DIRECT ASSET SOURCING"
            icon={Warehouse}
            title="Our Inventory Sources"
            lead="Our auction lots are sourced directly through institutional relationships, ensuring title legitimacy, lawful repossession documentation, and clean settlement procedures:"
            items={SOURCES}
          />
        </div>
      </section>

      {/* Core asset focus */}
      <section className="ab-section">
        <div className="ab-container">
          <div className="ab-head">
            <span className="ab-eyebrow"><span className="ab-dot" aria-hidden="true" /> Marketplace Spectrum</span>
            <h2>Our Core Asset Focus</h2>
            <p>We specialize across distinct automotive asset classes to provide tailored bidding opportunities for every category of commercial buyer.</p>
          </div>

          <div className="ab-focus">
            {ASSET_CATEGORIES.map(({ num, title, desc, icon: Icon }) => (
              <article key={num} className="ab-glass ab-focus-card">
                <div className="ab-focus-top">
                  <span className="ab-icon"><Icon size={20} aria-hidden="true" /></span>
                  <span className="ab-num">{num}</span>
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* What we offer + approach */}
      <section className="ab-section ab-last">
        <div className="ab-container">
          <div className="ab-offer">
            <div className="ab-glow ab-glow-b" aria-hidden="true" />
            <div className="ab-offer-col">
              <h2>What We Offer</h2>
              <ul className="ab-checks">
                {OFFERS.map((item) => (
                  <li key={item}><CheckCircle2 size={17} aria-hidden="true" /> {item}</li>
                ))}
              </ul>
            </div>

            <div className="ab-offer-col">
              <h2>Our Approach</h2>
              <p>
                Traditional automotive auctions have historically been fragmented, regional, and opaque. Our approach is to make vehicle auctions more accessible, transparent, and legally sound through a modern digital auction experience.
              </p>
              <p>
                By digitizing vehicle inspection frameworks, verifying bidder identities, and providing structured settlement processes, we empower buyers with dependable vehicle clarity.
              </p>
              <div className="ab-actions">
                <button type="button" className="ab-btn ab-btn-primary" onClick={onRegisterClick}>
                  Register <ArrowRight size={17} aria-hidden="true" />
                </button>
                <button type="button" className="ab-btn ab-btn-glass" onClick={onExploreClick}>
                  Browse Vehicles
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
