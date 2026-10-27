import { describe, expect, it } from 'vitest';
import { shuffledSuggestions, type SuggestionKind } from './suggestions';

describe('producer ideas', () => {
  it.each<SuggestionKind>(['song', 'ask', 'midi', 'drums', 'audio'])('has a diverse, unique pool and stable injectable randomness for %s', (kind) => {
    const pool = shuffledSuggestions(kind, 100, () => 0.5);
    expect(pool.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pool).size).toBe(pool.length);
    expect(shuffledSuggestions(kind, 6, () => 0)).not.toEqual(shuffledSuggestions(kind, 6, () => 0.99));
    expect(shuffledSuggestions(kind, 0)).toEqual([]);
  });
});
