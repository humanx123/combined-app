import { create } from 'zustand';

interface Toast { id: number; text: string; kind: 'info' | 'error' }

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

let n = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++n;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3000);
}
