import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { attachChatReference, chatReferenceCatalog } from '../chatReferences';

/** Native menus remain available for text/inputs; project objects get chat actions. */
export function ChatContextMenu() {
  const [target, setTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    const close = () => setTarget(null);
    const context = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input,textarea,[contenteditable="true"]') || window.getSelection()?.toString()) return;
      const id = el.closest<HTMLElement>('[data-chat-ref]')?.dataset.chatRef;
      if (!id || !chatReferenceCatalog().some((r) => r.id === id)) return;
      e.preventDefault(); openedAt.current = performance.now(); setTarget({ id, x: e.clientX, y: e.clientY });
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('contextmenu', context);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    const scroll = () => { if (performance.now() - openedAt.current > 150) close(); };
    window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('contextmenu', context); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - r.height - 8))}px`;
    el.querySelector('button')?.focus({ preventScroll: true });
  }, [target]);
  if (!target) return null;
  return createPortal(<div className="chat-context-menu" role="menu" aria-label="Project item actions" ref={ref} style={{ left: target.x, top: target.y }} onPointerDown={(e) => e.stopPropagation()}><button role="menuitem" onClick={() => { attachChatReference(target.id); setTarget(null); }}>Add to chat</button></div>, document.body);
}
