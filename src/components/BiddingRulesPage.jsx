import React from 'react';
import {
  UserCheck,
  FileSearch,
  Search,
  Scale,
  Ban,
  BadgeCheck,
  Receipt,
  CalendarCheck,
  AlertTriangle,
  Truck,
  FileText,
  Wrench,
  ShieldCheck,
  Gavel,
  ScrollText,
  ShieldAlert,
  ArrowRight,
  CheckCircle2
} from 'lucide-react';
import { BIDDING_RULES } from '../data/siteContent';

// One icon per rule, in the same order as BIDDING_RULES.
const RULE_ICONS = [
  UserCheck, FileSearch, Search, Scale, Ban, BadgeCheck, Receipt, CalendarCheck,
  AlertTriangle, Truck, FileText, Wrench, ShieldCheck, Gavel, ScrollText
];

const slug = (title) => title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function BiddingRulesPage({ onRegisterClick }) {
  const rules = BIDDING_RULES.map(([title, content], i) => ({
    id: slug(title),
    title: `${i + 1}. ${title}`,
    icon: RULE_ICONS[i] || Gavel,
    content
  }));

  return (
    <div className="salvex-bidding-rules-page">
      {/* 01 HERO */}
      <section className="rules-hero">
        <div className="salvex-container">
          <div className="rules-hero-inner">
            <span className="rules-pill">
              <ShieldAlert size={14} />
              BIDDING RULES
            </span>
            <h1 className="rules-title">Bidding Rules & Regulations</h1>
            <p className="rules-subtitle">
              How bidding, payment and handover work on Salvex Auction.
            </p>
          </div>
        </div>
      </section>

      {/* 02 MAIN RULES CONTENT */}
      <section className="rules-body-section">
        <div className="salvex-container">
          <div className="rules-content-layout">
            <div className="rules-main-column">
              {rules.map((rule) => {
                const IconComponent = rule.icon;
                return (
                  <div key={rule.id} id={rule.id} className="rule-card">
                    <div className="rule-card-header">
                      <div className="rule-icon-box">
                        <IconComponent size={20} />
                      </div>
                      <h2 className="rule-heading">{rule.title}</h2>
                    </div>

                    <p className="rule-text">{rule.content}</p>

                  </div>
                );
              })}
            </div>

            {/* Quick Sticky Summary Sidebar */}
            <aside className="rules-sidebar">
              <div className="rules-summary-card">
                <div className="summary-badge">
                  <CheckCircle2 size={16} />
                  <span>Bidder Checklist</span>
                </div>
                <h3>Quick Reference</h3>
                <ul className="rules-quick-list">
                  <li><strong>Register:</strong> only registered users can bid.</li>
                  <li><strong>Check first:</strong> review the details and inspect where allowed.</li>
                  <li><strong>Binding:</strong> submitted bids cannot be withdrawn.</li>
                  <li><strong>Sale:</strong> the highest bid is subject to seller approval.</li>
                  <li><strong>After winning:</strong> pay and collect within the given deadline.</li>
                </ul>

                <button
                  type="button"
                  className="salvex-btn salvex-btn-primary w-full"
                  onClick={onRegisterClick}
                >
                  <span>Register as Bidder</span>
                  <ArrowRight size={15} />
                </button>
              </div>

              <div className="rules-disclaimer-box">
                <AlertTriangle size={18} className="text-warning" />
                <p>
                  <strong>Note:</strong> Some vehicles may carry extra conditions from the owner (for example a bank or insurer). These are shown on the auction page.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
