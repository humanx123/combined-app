import { beforeEach, describe, expect, it } from 'vitest';
import { acknowledgeAi, finishLegalAcceptance, hasAiConsent, LEGAL_VERSION, legalReceipt, requestLegalAcceptance, useLegalConsent } from './acceptance';

const cache = new Map<string, string>();
beforeEach(() => {
  cache.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{ getItem:(key:string) => cache.get(key) ?? null, setItem:(key:string,value:string) => cache.set(key,value), removeItem:(key:string) => cache.delete(key) } });
  finishLegalAcceptance(false);
});
describe('agreement decisions', () => {
  it('does not infer acceptance from opening or canceling the prompt', async () => {
    const decision = requestLegalAcceptance();
    expect(useLegalConsent.getState().open).toBe(true);
    finishLegalAcceptance(false);
    expect(await decision).toBe(false);
    expect(useLegalConsent.getState().open).toBe(false);
  });
  it('resolves only the explicit continue decision and versions its receipt', async () => {
    const decision = requestLegalAcceptance();
    expect(await requestLegalAcceptance()).toBe(false);
    finishLegalAcceptance(true);
    expect(await decision).toBe(true);
    expect(legalReceipt()).toEqual({ adult:true, termsVersion:LEGAL_VERSION, privacyVersion:LEGAL_VERSION });
  });
  it('requires a current, affirmative AI acknowledgement on each browser', () => {
    expect(hasAiConsent()).toBe(false);
    cache.set('vibe:ai-consent', 'old');
    expect(hasAiConsent()).toBe(false);
    acknowledgeAi(true);
    expect(hasAiConsent()).toBe(true);
    acknowledgeAi(false);
    expect(hasAiConsent()).toBe(false);
  });
});
