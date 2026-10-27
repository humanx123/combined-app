import { afterEach, describe, expect, it } from 'vitest';
import { systemPrompt } from './prompts';
import { MAX_CUSTOM_INSTRUCTIONS, sanitizeSettings, useSettings } from '../state/settings';
afterEach(() => useSettings.getState().set({ customInstructions: '' }));
describe('custom instructions', () => {
  it('applies preferences to both chat modes while retaining Ask restrictions', () => {
    useSettings.getState().set({ customInstructions: 'Use gentle drums and leave headroom.' });
    expect(systemPrompt('agent')).toContain('Use gentle drums and leave headroom.');
    expect(systemPrompt('ask')).toContain('Use gentle drums and leave headroom.');
    expect(systemPrompt('ask')).toContain('Mode: Ask');
    expect(systemPrompt('ask')).toContain('cannot change the project');
  });
  it('bounds persisted/cloud instructions and supports clearing them', () => {
    expect(sanitizeSettings({ customInstructions: 7 }).customInstructions).toBe('');
    useSettings.getState().set({ customInstructions: 'x'.repeat(5000) });
    expect(useSettings.getState().customInstructions).toHaveLength(MAX_CUSTOM_INSTRUCTIONS);
    useSettings.getState().set({ customInstructions: '' }); expect(systemPrompt('agent')).not.toContain("# User's custom instructions");
  });
});
