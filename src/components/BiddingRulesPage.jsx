import React from 'react';
import {
  Gavel,
  ShieldAlert,
  Clock,
  Ban,
  CalendarCheck,
  Search,
  Truck,
  Receipt,
  ArrowRight,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

export default function BiddingRulesPage({ onRegisterClick }) {
  const rules = [
    {
      id: 'eligibility',
      title: '1. Who Can Bid',
      icon: ShieldAlert,
      content:
        'You need a Salvex account with a verified email and approved KYC (identity documents checked by our team). Bidding can be blocked for accounts that are suspended.'
    },
    {
      id: 'starting-bid',
      title: '2. Starting Price & Higher Bids',
      icon: Gavel,
      content:
        'Every auction shows a starting price. The first bid must be at least the starting price. Every later bid must be higher than the current highest bid, by any amount; there is no fixed increment. Before each bid you see the amount again and accept the terms.'
    },
    {
      id: 'closing-time',
      title: '3. Closing Time & Time Extension',
      icon: Clock,
      content:
        'Auctions open and close by the Salvex server clock, not the clock on your device. When time extension is switched on for an auction, a bid placed in the last few minutes moves the end time forward by the same number of minutes, so other bidders can respond. The auction page shows whether extension is on.'
    },
    {
      id: 'cancellation',
      title: '4. Bids Cannot Be Withdrawn',
      icon: Ban,
      content:
        'A bid is a binding offer to buy the vehicle at that amount. Once placed, it cannot be cancelled, withdrawn or reduced. Check the photos and details carefully before you bid.'
    },
    {
      id: 'payment-deadline',
      title: '5. After You Win',
      icon: CalendarCheck,
      content:
        'The highest bidder when the auction closes wins and is notified at once. Our team then contacts the winner to complete the purchase, the documents and the handover. Any service fee is explained by our team before the purchase is completed.'
    },
    {
      id: 'non-payment',
      title: '6. If a Winner Withdraws',
      icon: AlertTriangle,
      content:
        'A winning bid is a commitment to buy. A winner who withdraws without a valid reason may lose the right to bid on future auctions.'
    },
    {
      id: 'inspection',
      title: '7. "As-Is, Where-Is" Condition',
      icon: Search,
      content:
        'Salvage, damaged and used vehicles are sold "as-is, where-is", with all faults and damage. Study the photos, damage notes and documents listed for each vehicle, and contact us if you want to inspect a vehicle before bidding.'
    },
    {
      id: 'handover',
      title: '8. Receipt, Documents & Handover',
      icon: Truck,
      content:
        'After the payment is confirmed you can print the receipt from your dashboard. Our team then contacts you to hand over the vehicle and its documents. The buyer is responsible for the RTO transfer after handover.'
    },
    {
      id: 'charges',
      title: '9. Fees & Taxes',
      icon: Receipt,
      content:
        'The amount to pay is shown on your order. If any additional fee or tax applies to a vehicle, it is stated on the auction page before bidding.'
    }
  ];

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
                  <li><strong>KYC:</strong> approved ID documents needed before bidding.</li>
                  <li><strong>Bids:</strong> at least the starting price, then higher than the current bid.</li>
                  <li><strong>Binding:</strong> bids cannot be withdrawn.</li>
                  <li><strong>After winning:</strong> our team contacts you to complete the purchase.</li>
                  <li><strong>Handover:</strong> arranged by our team.</li>
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
