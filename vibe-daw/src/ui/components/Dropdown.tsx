import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '../icons';
import { uiZoom } from '../hooks';

/** Shared, keyboard-accessible menu, positioned outside clipped studio panels. */
export function Dropdown({ label, children, content, className = '', role = 'menu' }: {
  label: string;
  children: ReactNode;
  content: (close: () => void) => ReactNode;
  className?: string;
  role?: 'menu' | 'listbox';
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ left: 0, top: 0, maxHeight: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect(), z = uiZoom();
    // Mobile innerWidth can include overflowing page content at larger UI sizes.
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement;
    const height = menu.current!.getBoundingClientRect().height;
    const below = viewportHeight - r.bottom - 14;
    const top = height > below && r.top > below ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    const width = menu.current!.getBoundingClientRect().width;
    setAt({ left: Math.max(8, Math.min(r.left, viewportWidth - width - 8)) / z, top: top / z, maxHeight: (viewportHeight - top - 8) / z });
    const selected = menu.current!.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? menu.current!.querySelector<HTMLElement>('button:not(:disabled), select'))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const scroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) dismiss(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  return <>
    <button ref={trigger} className={`btn dropdown-trigger ${className}`} aria-label={label} aria-haspopup={role} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
      {children}<ChevronDown size={12} />
    </button>
    {open && createPortal(<div ref={menu} id={id} className="menu dropdown-menu" role={role} aria-label={label} style={{ ...at, maxWidth: (document.documentElement.clientWidth - 16) / uiZoom(), maxHeight: at.maxHeight || undefined }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'Tab') setOpen(false);
        if (e.target instanceof HTMLSelectElement) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = [...menu.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select')];
          const current = items.indexOf(document.activeElement as HTMLElement);
          const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }
      }}>{content(close)}</div>, document.getElementById('root')!)}
  </>;
}
