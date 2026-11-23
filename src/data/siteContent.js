// Static site text: home page steps and features, FAQ and policy pages.
// Policy text is a draft until the company approves it.

export const howItWorksSteps = [
  {
    number: '01',
    title: 'Register',
    description: 'Create an id on Salvex Auction to explore vehicles, spare parts, and services.'
  },
  {
    number: '02',
    title: 'Explore Our Categories',
    description: 'Vehicle auctions, used spare parts, insurance and vehicle-related services.'
  },
  {
    number: '03',
    title: 'Review Details',
    description: 'Check the details, photographs, condition, documents and prices.'
  },
  {
    number: '04',
    title: 'Place Your Bid',
    description: 'Bid on vehicles by the auction rules, or enquire about parts and insurance.'
  },
  {
    number: '05',
    title: 'Confirmation',
    description: 'Successful bidders receive instructions on the next steps.'
  },
  {
    number: '06',
    title: 'Complete Payment',
    description: 'Pay according to the confirmed terms and conditions.'
  },
  {
    number: '07',
    title: 'Complete',
    description: 'Complete the formalities and collect from the designated location.'
  }
];

export const whySalvexFeatures = [
  {
    number: '01',
    title: 'Verified Listings',
    description: 'Detailed vehicle information, photographs and available documents.',
    color: '#16A344', // Success Green
    semanticName: 'Success Green'
  },
  {
    number: '02',
    title: 'Transparent Bidding',
    description: 'A clear and open online auction process.',
    color: '#075BFF', // Brand Blue
    semanticName: 'Brand Blue'
  },
  {
    number: '03',
    title: 'Secure Transactions',
    description: 'Safe and reliable payment process.',
    color: '#3B82F6', // Info Blue
    semanticName: 'Info Blue'
  },
  {
    number: '04',
    title: 'Dedicated Support',
    description: 'Assistance throughout the auction process.',
    color: '#0B1220', // Primary Navy
    semanticName: 'Primary Navy'
  }
];


// FAQS DATA
export const faqData = [
  {
    id: 'faq-1',
    category: 'Registration & KYC',
    question: 'How do I register as an approved bidder on Salvex Auction?',
    answer: 'Click "Register", fill in your details and enter the code we email you. Then open your dashboard, go to KYC & documents and upload your ID documents. Once our team approves them, you can bid on any auction. You are notified of the decision.'
  },
  {
    id: 'faq-2',
    category: 'Registration & KYC',
    question: 'What documents are required to participate in bank and court asset auctions?',
    answer: 'A PAN card and one government photo ID (Aadhaar, passport, voter ID or driving licence). The KYC page lists exactly what to upload. Our team may ask for a clearer copy or an extra document.'
  },
  {
    id: 'faq-3',
    category: 'Bidding Process',
    question: 'How does live bidding work on Salvex Auction?',
    answer: 'Each auction has a starting price. The first bid must be at least the starting price; every later bid must be higher than the current highest bid, by any amount. You confirm each bid and accept the terms before it is placed. The server clock decides when an auction opens and closes.'
  },
  {
    id: 'faq-4',
    category: 'Bidding Process',
    question: 'Can I cancel or retract a bid once submitted?',
    answer: 'No. To maintain complete market integrity and fairness, all bids placed on Salvex Auction are strictly non-cancellable and irrevocable. Placing a bid constitutes a legally binding purchase offer.'
  },
  {
    id: 'faq-5',
    category: 'Bidding Process',
    question: 'What is the dynamic overtime rule (anti-sniping)?',
    answer: 'When time extension is switched on for an auction, a bid placed in the last few minutes (usually 2) extends the end time, so other bidders have a fair chance to respond. The auction page shows whether extension is on.'
  },
  {
    id: 'faq-6',
    category: 'Payment & Settlement',
    question: 'What happens after I win an auction?',
    answer: 'You do not pay on the website. When you win, our team contacts you to complete the purchase, explain any service fee and arrange the documents and handover. Your dashboard shows each win and its status.'
  },
  {
    id: 'faq-7',
    category: 'Vehicle Lifting',
    question: 'How and when do I lift and collect the vehicle?',
    answer: 'Our team contacts you to arrange the handover and the vehicle documents.'
  },
  {
    id: 'faq-8',
    category: 'Selling Vehicles',
    question: 'How can an individual, dealer, or institution list a vehicle on Salvex?',
    answer: 'Register as a seller and open "Sell". Enter the vehicle details and upload photos. Our team reviews the listing, may ask for changes, and once approved schedules it for auction. You are notified at every step.'
  }
];

// LEGAL POLICIES DATA
export const legalPoliciesData = {
  terms: {
    title: 'Terms & Conditions',
    lastUpdated: 'Draft – pending company approval',
    sections: [
      {
        heading: '1. Platform Overview & Eligibility',
        content: 'Salvex Auction is an online commercial auction marketplace providing certified bidding facilitation for used, salvage, insurance-loss, and bank-repossessed automotive assets. Bidding participation requires full KYC verification and compliance with applicable Indian motor vehicle laws.'
      },
      {
        heading: '2. Irrevocability of Live Bids',
        content: 'Every bid submitted through the Salvex bidding terminal represents an irrevocable, legally binding offer to purchase the specified lot at the entered financial consideration. Bid retractions are strictly prohibited under platform auction bylaws.'
      },
      {
        heading: '3. As-Is, Where-Is Basis',
        content: 'Unless explicitly covered by an authorized mechanical warranty certificate, all salvage, repossessed, and pre-owned auction lots are sold strictly on an "As-Is, Where-Is" basis. Bidders should study the photos and details, and may contact us to arrange an inspection before bidding.'
      }
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    lastUpdated: 'Draft – pending company approval',
    sections: [
      {
        heading: '1. Information We Collect',
        content: 'We collect personal identification data (Full legal name, phone number, email address, physical address, PAN details, government ID records, and vehicle registration certificates) strictly for identity authentication, anti-fraud compliance, and statutory RTO transfer protocols.'
      },
      {
        heading: '2. Payments and Data Security',
        content: 'The website does not take payments and never asks for card or banking passwords. Payments are settled directly with our team. KYC documents are kept in private storage visible only to our review team.'
      }
    ]
  },
  refund: {
    title: 'Refund & Earnest Money Deposit (EMD) Policy',
    lastUpdated: 'Draft – pending company approval',
    sections: [
      {
        heading: '1. Refundable Security Deposit',
        content: 'No deposit is needed to bid. If a payment is made for an order that is later cancelled by us, the amount is returned to the paying bank account after verification.'
      },
      {
        heading: '2. If a Winner Withdraws',
        content: 'A winning bid is a commitment to buy. A winner who withdraws without a valid reason may lose the right to bid on future auctions.'
      }
    ]
  },
  auction: {
    title: 'Official Auction Policy & Guidelines',
    lastUpdated: 'Draft – pending company approval',
    sections: [
      {
        heading: '1. Starting Price & Bids',
        content: 'Every auction shows a starting price. The first bid must be at least the starting price and each later bid must be higher than the current highest bid. Bids cannot be withdrawn.'
      },
      {
        heading: '2. Time Extension',
        content: 'When enabled for an auction, a bid in the final minutes extends the end time by the same number of minutes, until no new bid arrives in that window.'
      },
      {
        heading: '3. Payment & Handover',
        content: 'After the auction, our team contacts the winner to complete the purchase, the documents and the handover of the vehicle.'
      }
    ]
  }
};


// The 15 bidding rules: shown on How It Works and on the Bidding Rules page.
export const BIDDING_RULES = [
  ['Registration', 'Only registered users may participate in auctions, subject to the applicable auction terms.'],
  ['Vehicle Verification', 'Review all available vehicle details, photographs, damage information, and documents before bidding.'],
  ['Vehicle Inspection', "Inspect the vehicle wherever inspection is permitted. Bidders should assess the vehicle's condition before placing a bid."],
  ['Responsible Bidding', 'Place bids carefully and only at amounts you are willing and able to pay.'],
  ['Bid Withdrawal', 'Submitted bids cannot be withdrawn unless permitted under the applicable auction terms and conditions.'],
  ['Seller Approval', "The highest bid does not automatically guarantee a sale. The sale remains subject to the seller's approval and applicable auction conditions."],
  ['Auction Service Charges', 'Applicable auction service charges will be communicated to bidders according to the relevant auction terms.'],
  ['Payment Deadline', 'Successful bidders must complete payment within the specified deadline.'],
  ['Payment Default', 'Failure to complete payment may result in cancellation of the bid or other action in accordance with the applicable auction terms.'],
  ['Vehicle Pickup', 'Successful bidders must collect vehicles within the specified period. Any applicable late pickup charges will be communicated in advance.'],
  ['Documentation', 'Buyers must complete the required documentation and comply with applicable legal requirements.'],
  ['Spare Parts Purchases', 'Spare-part enquiries, availability, condition, pricing, payment, delivery, and returns are subject to the applicable seller terms.'],
  ['Insurance Services', 'Insurance coverage, premium, policy issuance, exclusions, and claims are subject to the terms and conditions of the relevant insurer. Policy issuance is subject to insurer approval.'],
  ['Cancellation & Disputes', 'Cancellations, refunds, and disputes will be handled according to the applicable terms and conditions and relevant laws.'],
  ['Acceptance of Terms', 'By using Salvex Auction and participating in its services, users agree to the applicable terms and conditions.']
];
