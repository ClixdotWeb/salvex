import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock } from 'lucide-react';
import './DateTimePicker.css';

/*
 * Themed date / date-time picker used instead of the browser's <input type="date|datetime-local">.
 * Write it like those inputs: the value is local time as text, "2026-10-28T10:00" (datetime) or "2026-10-28" (date),
 * and onChange receives { target: { value } }. min / max use the same format (whole days are compared).
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const QUICK_TIMES = [[9, 0], [10, 0], [12, 0], [15, 0], [18, 0]];
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
}
const format = (d, withTime) => `${dayKey(d)}${withTime ? `T${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`;
const timeLabel = (h, m) => `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
const showValue = (d, withTime) => {
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? `${date} · ${timeLabel(d.getHours(), d.getMinutes())}` : date;
};

export default function DateTimePicker({
  value, onChange, mode = 'datetime', min, max, disabled, placeholder, required, id, 'aria-label': ariaLabel,
}) {
  const withTime = mode === 'datetime';
  const selected = parse(value);
  const minDay = min ? dayKey(parse(min)) : null;
  const maxDay = max ? dayKey(parse(max)) : null;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected || new Date());       // the month shown
  const [style, setStyle] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  const minDate = min ? parse(min) : null;
  // never earlier than `min` (a past time today, or an end before the start, is moved up to `min`)
  const emit = (raw) => {
    const d = withTime && minDate && raw < minDate ? new Date(minDate) : raw;
    onChange?.({ target: { value: format(d, withTime) }, currentTarget: { value: format(d, withTime) } });
  };

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    if (window.innerWidth < 560) { setStyle({ sheet: true }); return; }               // phones: a bottom sheet
    const width = withTime ? 600 : 312;
    const height = withTime ? 400 : 380;
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    if (below >= height || below >= above) setStyle({ left, width, top: r.bottom + 6, maxHeight: Math.max(below, 260) });
    else setStyle({ left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(above, 260) });
  }, [withTime]);

  const openPanel = () => {
    if (disabled) return;
    setView(selected || (min ? parse(min) : new Date()));
    place();
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) buttonRef.current?.focus(); };

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!buttonRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) close(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onMove = (e) => { if (!panelRef.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  // ------------------------------------------------------------------ the month grid
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const todayKey = dayKey(new Date());
  const allowed = (d) => (!minDay || dayKey(d) >= minDay) && (!maxDay || dayKey(d) <= maxDay);
  const shiftMonth = (n) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));

  const pickDay = (d) => {
    const next = new Date(d);
    const base = selected || (() => { const t = new Date(); t.setHours(10, 0, 0, 0); return t; })();
    next.setHours(withTime ? base.getHours() : 0, withTime ? base.getMinutes() : 0, 0, 0);
    emit(next);
    if (!withTime) close();
  };

  // ------------------------------------------------------------------ time
  const base = selected || (() => { const t = new Date(); t.setMinutes(0, 0, 0); return t; })();
  const setTime = (h, m) => { const d = new Date(base); d.setHours(h, m, 0, 0); emit(d); };
  const hours = base.getHours();
  const minutes = base.getMinutes();
  const stepHour = (n) => setTime((hours + n + 24) % 24, minutes);
  const stepMinute = (n) => {
    const total = (hours * 60 + minutes + n + 1440) % 1440;
    setTime(Math.floor(total / 60), total % 60);
  };
  const setHalf = (pm) => { if (pm !== hours >= 12) setTime((hours + 12) % 24, minutes); };

  const presets = withTime ? [
    ['In 1 hour', () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }],
    ['Tomorrow 10 AM', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; }],
    ['In 3 days', () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(base.getHours(), base.getMinutes(), 0, 0); return d; }],
  ] : [
    ['Today', () => new Date()],
    ['Yesterday', () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; }],
  ];

  const panel = (
    <div ref={panelRef} id={panelId} role="dialog" aria-label={withTime ? 'Choose date and time' : 'Choose date'}
      className={`sx-dtp-panel${style?.sheet ? ' sheet' : ''}${withTime ? ' with-time' : ''}`} style={style?.sheet ? undefined : style}>
      <div className="sx-dtp-body">
      <div className="sx-dtp-cal">
      <div className="sx-dtp-head">
        <button type="button" className="sx-dtp-nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={18} /></button>
        <strong>{MONTHS[view.getMonth()]} {view.getFullYear()}</strong>
        <button type="button" className="sx-dtp-nav" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="sx-dtp-grid" role="grid">
        {DAYS.map((d) => <span key={d} className="sx-dtp-dow">{d}</span>)}
        {cells.map((d) => {
          const key = dayKey(d);
          const out = d.getMonth() !== view.getMonth();
          const isSel = selected && dayKey(selected) === key;
          const ok = allowed(d);
          return (
            <button key={key} type="button" disabled={!ok} data-date={key}
              className={`sx-dtp-day${out ? ' out' : ''}${isSel ? ' selected' : ''}${key === todayKey ? ' today' : ''}`}
              aria-label={d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              aria-pressed={Boolean(isSel)} onClick={() => pickDay(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      </div>

      {withTime && (
        <div className="sx-dtp-time">
          <div className="sx-dtp-time-label"><Clock size={14} /> Time</div>
          <div className="sx-dtp-clock">
            <div className="sx-dtp-spin">
              <button type="button" aria-label="Hour up" onClick={() => stepHour(1)}><ChevronUp size={16} /></button>
              <NumberBox label="Hour" value={hours % 12 || 12} min={1} max={12} onStep={stepHour}
                onSet={(h) => setTime((h % 12) + (hours >= 12 ? 12 : 0), minutes)} />
              <button type="button" aria-label="Hour down" onClick={() => stepHour(-1)}><ChevronDown size={16} /></button>
            </div>
            <span className="sx-dtp-colon">:</span>
            <div className="sx-dtp-spin">
              <button type="button" aria-label="Minutes up" onClick={() => stepMinute(1)}><ChevronUp size={16} /></button>
              <NumberBox label="Minutes" value={minutes} min={0} max={59} onStep={stepMinute} onSet={(m) => setTime(hours, m)} />
              <button type="button" aria-label="Minutes down" onClick={() => stepMinute(-1)}><ChevronDown size={16} /></button>
            </div>
            <div className="sx-dtp-ampm" role="group" aria-label="AM or PM">
              <button type="button" className={hours < 12 ? 'active' : ''} aria-pressed={hours < 12} onClick={() => setHalf(false)}>AM</button>
              <button type="button" className={hours >= 12 ? 'active' : ''} aria-pressed={hours >= 12} onClick={() => setHalf(true)}>PM</button>
            </div>
          </div>
          <div className="sx-dtp-chips">
            {QUICK_TIMES.map(([h, m]) => (
              <button key={`${h}${m}`} type="button" className={hours === h && minutes === m ? 'active' : ''} onClick={() => setTime(h, m)}>{timeLabel(h, m)}</button>
            ))}
          </div>
        </div>
      )}
      </div>

      <div className="sx-dtp-foot">
        <div className="sx-dtp-presets">
          {presets.map(([label, make]) => {
            const d = make();
            return <button key={label} type="button" disabled={!allowed(d)} onClick={() => { emit(d); setView(d); if (!withTime) close(); }}>{label}</button>;
          })}
        </div>
        <button type="button" className="sx-dtp-done" onClick={() => close()}>Done</button>
      </div>
    </div>
  );

  return (
    <>
      <button ref={buttonRef} type="button" id={id} disabled={disabled}
        className={`sx-dtp-trigger${open ? ' open' : ''}${selected ? '' : ' is-placeholder'}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={ariaLabel}
        aria-required={required || undefined} onClick={() => (open ? close() : openPanel())}>
        <CalendarDays size={16} className="sx-dtp-icon" aria-hidden="true" />
        <span className="sx-dtp-value">{selected ? showValue(selected, withTime) : (placeholder || (withTime ? 'Choose date and time' : 'Choose a date'))}</span>
        <ChevronDown size={16} className="sx-dtp-chevron" aria-hidden="true" />
      </button>
      {open && style && createPortal(
        style.sheet ? <div className="sx-dtp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>{panel}</div> : panel,
        document.body,
      )}
    </>
  );
}

/** Hour / minute box: type a number (applied when it is complete or on leaving), arrow keys / wheel step by one. */
function NumberBox({ label, value, min, max, onSet, onStep }) {
  const [text, setText] = useState(null);           // what is being typed; null = show the value
  const commit = (raw) => {
    const n = Number(raw);
    if (raw !== '' && Number.isInteger(n) && n >= min && n <= max) onSet(n);
    setText(null);
  };
  return (
    <input className="sx-dtp-num" aria-label={label} inputMode="numeric" maxLength={2}
      value={text ?? pad(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
        setText(raw);
        if (raw.length === 2) commit(raw);
      }}
      onBlur={() => { if (text !== null) commit(text); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); onStep(1); setText(null); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); onStep(-1); setText(null); }
        else if (e.key === 'Enter') { e.preventDefault(); if (text !== null) commit(text); }
      }}
      onWheel={(e) => { if (document.activeElement === e.currentTarget) onStep(e.deltaY < 0 ? 1 : -1); }} />
  );
}
