import { create } from 'zustand';

/** Kept separate from the DSP module so inspecting effects doesn't load Tone. */
export const useCustomFxErrors = create<Record<string, string | undefined>>(() => ({}));

export function reportCustomFxError(id: string, error: string | undefined) {
  if (useCustomFxErrors.getState()[id] !== error) useCustomFxErrors.setState({ [id]: error });
}
