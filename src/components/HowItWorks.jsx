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
  ArrowRight
} from 'lucide-react';
import { howItWorksSteps } from '../data/siteContent';
import './HowItWorks.css';

gsap.registerPlugin(ScrollTrigger);

const ICONS = [UserPlus, LayoutGrid, FileSearch, Gavel, BadgeCheck, CreditCard, Truck];

export default function HowItWorks({ steps = howItWorksSteps }) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const items = root.querySelectorAll('.hw-step');
    const last = items.length - 1;
    const mm = gsap.matchMedia(root);

    // Without motion (or before JS) every step is shown lit and the line is full.
    // With motion, the line fills as the section scrolls and each step lights up as the line reaches it.
    const setup = (axis) => () => {
      const fill = root.querySelector('.hw-line-fill');
      items.forEach((el) => el.classList.remove('is-on'));
      gsap.set(fill, axis === 'x' ? { scaleX: 0, scaleY: 1 } : { scaleY: 0, scaleX: 1 });

      gsap.to(fill, {
        [axis === 'x' ? 'scaleX' : 'scaleY']: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root.querySelector('.hw-track'),
          start: axis === 'x' ? 'top 85%' : 'top 70%',
          end: axis === 'x' ? 'bottom 25%' : 'bottom 50%',
          scrub: true,   // moves exactly with the scroll, no catch-up animation
          onUpdate: (self) => {
            const p = self.progress;
            items.forEach((el, i) => el.classList.toggle('is-on', p > 0 && p >= i / last - 0.001));
          }
        }
      });

      gsap.from('.hw-head > *', {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.hw-head', start: 'top 85%', once: true }
      });

      gsap.from(items, {
        opacity: 0,
        y: 32,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.hw-track', start: 'top 85%', once: true }
      });

      return () => items.forEach((el) => el.classList.add('is-on'));
    };

    mm.add('(min-width: 1025px) and (prefers-reduced-motion: no-preference)', setup('x'));
    mm.add('(max-width: 1024px) and (prefers-reduced-motion: no-preference)', setup('y'));

    // Sections above (auction cards) load later and push this one down: recalculate the scroll
    // positions whenever the page height changes, so the line follows the real scroll position.
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
  }, [steps]);

  return (
    <section className="hw" id="how-it-works" ref={rootRef} aria-labelledby="hw-title">
      <div className="hw-glow" aria-hidden="true" />
      <div className="hw-container">
        <div className="hw-head">
          <p className="hw-eyebrow">Salvex Auction</p>
          <h2 className="hw-title" id="hw-title">How It Works</h2>
          <Link to="/how-it-works" className="hw-link">
            See full process <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <div className="hw-track">
          <span className="hw-line" aria-hidden="true">
            <span className="hw-line-fill" />
          </span>
          <ol className="hw-steps">
            {steps.map((step, i) => {
              const Icon = ICONS[i] || ICONS[ICONS.length - 1];
              return (
                <li key={step.number} className="hw-step is-on">
                  <span className="hw-node" aria-hidden="true">
                    <Icon size={20} strokeWidth={1.9} />
                  </span>
                  <div className="hw-body">
                    <span className="hw-num">{step.number}</span>
                    <h3 className="hw-step-title">{step.title}</h3>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
