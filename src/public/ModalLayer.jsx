import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Puts a popup on top of everything (header and footer included): it is drawn at the end of <body>,
 * the page behind it does not scroll, and Escape closes it (unless `locked`, e.g. while sending).
 */
export default function ModalLayer({ onClose, locked = false, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !locked) onClose(); };
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = before; };
  }, [onClose, locked]);

  return createPortal(
    <div className="pub-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      {children}
    </div>,
    document.body,
  );
}
