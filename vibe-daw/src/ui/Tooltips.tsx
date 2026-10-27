import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Tip { text: string; key?: string; anchor: HTMLElement }

/** Render outside the zoomed studio and clamp the measured box to the viewport. */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); current = null; setTip(null); };
    const show = (target: EventTarget | null, delay: number) => {
      const el = (target as Element | null)?.closest?.('[title],[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      if (el.title) { if (el.tagName === 'BUTTON' && !el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', el.title); el.dataset.tip = el.title; el.removeAttribute('title'); }
      if (!el.dataset.tip) return;
      current = el;
      timer = setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const raw = el.dataset.tip!;
        // Only actual shortcuts become keycaps; explanatory parentheses stay prose.
        const m = raw.match(/^(.*?)\s*\(((?:(?:Ctrl|Cmd|Alt|Shift|Meta)\+)*[A-Z0-9]|Space|Enter|Esc|Delete|F\d{1,2})\)$/);
        setTip({ text: m ? m[1] : raw, key: m?.[2], anchor: el });
      }, delay);
    };
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') show(e.target, 450); };
    const out = (e: PointerEvent) => { if (current && !current.contains(e.relatedTarget as Node | null)) hide(); };
    const focus = (e: FocusEvent) => show(e.target, 250);
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerout', out);
    window.addEventListener('focusin', focus);
    window.addEventListener('focusout', hide);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', hide, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerover', over); window.removeEventListener('pointerout', out);
      window.removeEventListener('focusin', focus); window.removeEventListener('focusout', hide);
      window.removeEventListener('pointerdown', hide, true); window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide); window.removeEventListener('keydown', hide, true);
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const anchor = tip.anchor.getBoundingClientRect(), box = el.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const below = anchor.bottom + 8;
    el.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - box.width / 2, vw - box.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(below + box.height <= vh - 8 ? below : anchor.top - box.height - 8, vh - box.height - 8))}px`;
    el.style.visibility = 'visible';
  }, [tip]);
  if (!tip) return null;
  return createPortal(<div className="tooltip" role="tooltip" ref={ref} style={{ left: 0, top: 0, visibility: 'hidden' }}><span>{tip.text}</span>{tip.key && <kbd>{tip.key}</kbd>}</div>, document.body);
}
