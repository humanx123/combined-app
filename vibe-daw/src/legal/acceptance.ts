import { create } from 'zustand';

export const LEGAL_VERSION = '2026-10-20';
interface ConsentState { open: boolean; provider:'apple'|'google'; resolve: ((accepted: boolean) => void) | null; }
export const useLegalConsent = create<ConsentState>(() => ({ open: false, provider:'google', resolve: null }));
export function requestLegalAcceptance(): Promise<boolean> {
  if (useLegalConsent.getState().open) return Promise.resolve(false);
  return new Promise(resolve => useLegalConsent.setState({ open: true, resolve }));
}
export function finishLegalAcceptance(accepted: boolean) {
  const resolve = useLegalConsent.getState().resolve;
  useLegalConsent.setState({ open: false, resolve: null });
  resolve?.(accepted);
}
export function legalReceipt() { return { termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION, adult: true }; }
export function hasAiConsent(): boolean {
  try { return localStorage.getItem('vibe:ai-consent') === LEGAL_VERSION; } catch { return false; }
}
export function acknowledgeAi(accepted: boolean) {
  try { if (accepted) localStorage.setItem('vibe:ai-consent', LEGAL_VERSION); else localStorage.removeItem('vibe:ai-consent'); } catch { /* unavailable storage leaves AI disabled */ }
}
