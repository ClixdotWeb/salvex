import React, { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './Select.css';

/** Plain text of an <option>'s children ("2019 ", "Swift" -> "2019 Swift"). */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

function itemsFrom(children) {
  return Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === 'option')
    .map((o) => {
      const label = textOf(o.props.children);
      return { value: String(o.props.value ?? label), label, disabled: Boolean(o.props.disabled) };
    });
}

const MENU_MAX_HEIGHT = 280;

/**
 * Themed drop-down used everywhere instead of the browser's <select>. Write it like a <select>:
 *   <Select value={v} onChange={(e) => setV(e.target.value)}><option value="">Any</option>…</Select>
 * Keyboard: arrows / Home / End move, Enter or Space choose, Esc closes, typing a letter jumps to it.
 */
export default function Select({
  value, onChange, children, disabled, className = '', id, name, placeholder = 'Select…',
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby,
}) {
  const all = itemsFrom(children);
  const current = all.find((i) => i.value === String(value ?? ''));
  // A disabled empty option is only the hint text ("Select…"): shown on the button, not in the list.
  const items = all.filter((i) => !(i.value === '' && i.disabled));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuStyle, setMenuStyle] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const listId = useId();

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const wanted = Math.min(MENU_MAX_HEIGHT, items.length * 40 + 12);
    const up = below < wanted + 8 && r.top > below;
    setMenuStyle({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8)),
      width: Math.max(r.width, 180),
      maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, (up ? r.top : below) - 12)),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [items.length]);

  const openMenu = () => {
    if (disabled || items.length === 0) return;
    place();
    setActive(items.findIndex((i) => i.value === String(value ?? '')));     // -1 = nothing chosen yet
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };
  const choose = (item) => {
    if (!item || item.disabled) return;
    if (item.value !== String(value ?? '')) onChange?.({ target: { value: item.value, name }, currentTarget: { value: item.value, name } });
    close();
  };

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!buttonRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) close(false);
    };
    const onMove = (e) => {
      if (menuRef.current?.contains(e.target)) return;      // scrolling inside the list itself
      place();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (open && active >= 0) menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const step = (from, dir) => {
    for (let i = 1; i <= items.length; i += 1) {
      const next = (from + dir * i + items.length) % items.length;
      if (!items[next].disabled) return next;
    }
    return from;
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(items.length, -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      const letter = e.key.toLowerCase();
      const start = active < 0 ? 0 : active + 1;
      const order = [...items.keys()].map((k) => (start + k) % items.length);
      const hit = order.find((k) => !items[k].disabled && items[k].label.toLowerCase().startsWith(letter));
      if (hit !== undefined) setActive(hit);
    }
  };

  const showsPlaceholder = !current || current.value === '';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className={`sx-select${open ? ' open' : ''}${showsPlaceholder ? ' is-placeholder' : ''} ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="sx-select-value">{current ? current.label : (all.find((i) => i.value === '')?.label || placeholder)}</span>
        <ChevronDown size={16} className="sx-select-chevron" aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      {open && menuStyle && createPortal(
        <ul ref={menuRef} id={listId} role="listbox" className="sx-select-menu" style={menuStyle}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}>
          {items.map((item, i) => {
            const selected = item.value === String(value ?? '');
            return (
              <li
                key={`${item.value}-${i}`}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                aria-disabled={item.disabled || undefined}
                className={`sx-select-option${selected ? ' selected' : ''}${i === active ? ' active' : ''}${item.disabled ? ' disabled' : ''}`}
                onMouseEnter={() => !item.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                <span>{item.label}</span>
                {selected && <Check size={15} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
