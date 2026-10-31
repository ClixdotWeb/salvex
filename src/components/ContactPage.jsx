import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, MessageCircle, Mail, MapPin, Clock, Building2, CheckCircle2, ArrowRight } from 'lucide-react';
import './ContactPage.css';
import { CONTACT_SUBJECTS, sendContactMessage } from '../api/contact';
import { COMPANY, mapLink, telLink, waLink } from '../config/company';
import Select from './ui/Select';

const EMPTY_FORM = { fullName: '', mobile: '', email: '', subject: '', message: '' };

// Working hours: Mon - Sat, 9:00 AM - 6:00 PM India time.
function isOpenNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const day = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return day !== 'Sun' && hour >= 9 && hour < 18;
}

// Contact details the company has configured (no placeholder numbers), then the opening hours and yard visits.
function contactItems() {
  const place = COMPANY.address || COMPANY.city;
  return [
    COMPANY.phone && { id: 'phone', icon: Phone, label: 'Phone Number', value: COMPANY.phone, href: telLink(COMPANY.phone) },
    COMPANY.whatsapp && { id: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', value: COMPANY.whatsapp, href: waLink(COMPANY.whatsapp), external: true },
    COMPANY.email && { id: 'email', icon: Mail, label: 'Email', value: COMPANY.email, href: `mailto:${COMPANY.email}` },
    place && { id: 'address', icon: MapPin, label: 'Address', value: place, href: mapLink(place), external: true },
    { id: 'hours', icon: Clock, label: 'Working Hours', value: 'Mon - Sat, 9:00 AM - 6:00 PM (Sunday holiday)' },
    { id: 'yard', icon: Building2, label: 'Branch / Yard Visits', value: 'Please contact us in advance to schedule a yard inspection visit.' },
  ].filter(Boolean);
}

export default function ContactPage({ onShowToast }) {
  const presetSubject = new URLSearchParams(window.location.search).get('subject');
  const [formState, setFormState] = useState({
    ...EMPTY_FORM,
    subject: CONTACT_SUBJECTS.includes(presetSubject) ? presetSubject : '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentNumber, setSentNumber] = useState(null);
  const [formError, setFormError] = useState(null);
  const [website, setWebsite] = useState('');   // spam trap: stays empty for people
  const items = contactItems();
  const [open] = useState(isOpenNow);

  const set = (field) => (e) => setFormState((s) => ({ ...s, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formState.subject) {
      setFormError('Please select a subject.');
      if (onShowToast) onShowToast('Please select an enquiry subject');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const res = await sendContactMessage({
        name: formState.fullName, mobile: formState.mobile, email: formState.email,
        subject: formState.subject, message: formState.message, website,
      });
      setSentNumber(res.number);
    } catch (err) {
      setFormError(err.message || 'Could not send your message. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="ct-page">
      {/* Header band */}
      <section className="ct-band">
        <div className="ct-band-grid" aria-hidden="true" />
        <div className="ct-container ct-band-inner">
          <div className="ct-band-copy">
            <nav className="ct-crumbs" aria-label="Breadcrumb">
              <Link to="/">Home</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Contact Us</span>
            </nav>
            <h1 className="ct-title">Contact <span>Us</span></h1>
            <p className="ct-band-text">
              Questions about auctions, KYC, payments or vehicle handover? Our team is here to help.
            </p>
            <span className={`ct-status${open ? ' is-open' : ''}`}>
              <span className="ct-status-dot" aria-hidden="true" />
              {open ? 'Open now' : 'Closed now'}
            </span>
          </div>

          <div className="ct-band-visual" aria-hidden="true">
            <img src="/images/hero_daylight_mercedes.jpg" alt="" />
            <span className="ct-glass"><Clock size={16} /> Mon - Sat · 9:00 AM - 6:00 PM</span>
          </div>
        </div>
      </section>

      {/* Details + form */}
      <section className="ct-body">
        <div className="ct-container ct-grid">
          <div className="ct-info">
            <h2 className="ct-heading">Need more information?<br />Get in touch with us</h2>
            <p className="ct-lead">
              We're here to help. Get in touch with our team for any queries, support or partnership opportunities.
            </p>

            <ul className="ct-items">
              {items.map(({ id, icon: Icon, label, value, href, external }) => {
                const body = (
                  <>
                    <span className="ct-item-icon"><Icon size={18} aria-hidden="true" /></span>
                    <span className="ct-item-text"><strong>{label}</strong><span>{value}</span></span>
                  </>
                );
                return (
                  <li key={id}>
                    {href
                      ? <a href={href} className="ct-item is-link" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a>
                      : <div className="ct-item">{body}</div>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="ct-form-wrap">
            {sentNumber ? (
              <div className="ct-success" role="status">
                <CheckCircle2 size={40} aria-hidden="true" />
                <h2>Message sent</h2>
                <p>Thank you. Your reference number is <strong>{sentNumber}</strong>. Our team will reply by email or phone.</p>
                <button type="button" className="ct-btn ct-btn-ghost"
                  onClick={() => { setSentNumber(null); setFormState(EMPTY_FORM); }}>
                  Send another message
                </button>
              </div>
            ) : (
              <>
                <h2 className="ct-heading ct-heading-sm">Send Message</h2>
                <p className="ct-lead">Please fill out the form below with your details and message to contact us.</p>

                <form onSubmit={handleSubmit} className="ct-form">
                  <div className="ct-row">
                    <label className="ct-field">
                      <span className="ct-sr">Full name</span>
                      <input type="text" required maxLength={100} autoComplete="name" placeholder="Full Name *"
                        value={formState.fullName} onChange={set('fullName')} />
                    </label>
                    <label className="ct-field">
                      <span className="ct-sr">Mobile number</span>
                      <input type="tel" required maxLength={20} autoComplete="tel" inputMode="tel" placeholder="Mobile Number *"
                        value={formState.mobile} onChange={set('mobile')} />
                    </label>
                  </div>

                  <label className="ct-field">
                    <span className="ct-sr">Email address</span>
                    <input type="email" required autoComplete="email" placeholder="Email Address *"
                      value={formState.email} onChange={set('email')} />
                  </label>

                  <div className="ct-field">
                    <Select aria-label="Subject" value={formState.subject} onChange={set('subject')}>
                      <option value="" disabled>Select a Subject *</option>
                      {CONTACT_SUBJECTS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                    </Select>
                  </div>

                  <label className="ct-field">
                    <span className="ct-sr">Message</span>
                    <textarea required rows={6} maxLength={3000} placeholder="Write Message Here… *"
                      value={formState.message} onChange={set('message')} />
                  </label>

                  {/* Spam trap: hidden from people, bots fill it in */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                    value={website} onChange={(e) => setWebsite(e.target.value)} className="ct-trap" />

                  {formError && <p className="ct-error" role="alert">{formError}</p>}

                  <button type="submit" disabled={isSubmitting} className="ct-btn ct-btn-primary">
                    {isSubmitting ? 'Sending…' : 'Send Message'}
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
