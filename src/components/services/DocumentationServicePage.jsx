import React from 'react';
import { FileText, ShieldCheck, Building2, Stamp } from 'lucide-react';
import ServiceLayout from './ServiceLayout';

export default function DocumentationServicePage() {
  return (
    <ServiceLayout
      crumb="Documentation Assistance"
      title="Vehicle Documentation"
      highlight="Assistance"
      subtitle="Comprehensive legal facilitation for RTO Form 29/30 transfers, bank NOC clearances, hypothecation cancellations, and interstate re-registration."
      badge={{ icon: FileText, text: 'RTO Compliance & Title Clearance' }}
      intro={{
        icon: FileText,
        title: 'Complete Post-Auction RTO & Documentation Support',
        text: 'Navigating the documentation for bank-seized or insurance-salvage vehicles can be complex. Salvex provides dedicated legal assistance to ensure smooth ownership transfer, prompt release of original RC books, and statutory tax clearance across all state jurisdictions.',
      }}
      features={[
        {
          icon: Stamp,
          title: 'RTO Forms 29 & 30',
          text: 'Preparation and authentication of statutory sale notices and application for ownership transfer.',
        },
        {
          icon: Building2,
          title: 'Bank NOC & Hypothecation',
          text: 'Assistance with obtaining Form 35 loan closure NOCs from lending banks and NBFCs.',
        },
        {
          icon: ShieldCheck,
          title: 'Interstate Clearance',
          text: 'Issuance of interstate RTO NOC certificates and guidance on local state road tax computation.',
        },
      ]}
      cta={{
        title: 'Have Questions Regarding RTO Transfer?',
        text: 'Our legal and RTO liaison desk is ready to advise you on documentation requirements.',
        button: 'Consult RTO Desk',
      }}
    />
  );
}
