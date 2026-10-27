export type SuggestionKind = 'song' | 'ask' | 'midi' | 'drums' | 'audio';

const IDEAS: Record<SuggestionKind, string[]> = {
  song: [
    'Build a late-night garage track with shuffled drums and warm keys',
    'Make a dusty boom-bap beat with a bass line that answers the drums',
    'Write an intimate piano piece that grows into a cinematic chorus',
    'Make a dreamy indie-pop intro with guitar and a simple hook',
    'Create a fast jungle break with an atmospheric pad',
    'Build a minimal house groove with a moving bass line',
    'Write a neo-soul loop with rich chords and a pocket drum groove',
    'Make a playful chiptune melody with an unexpected bridge',
    'Turn this loop into a full two-minute arrangement',
    'Give the chorus a lift without making everything louder',
    'Write a quiet ambient piece using bells, cello, and long spaces',
    'Build an Afrobeat groove with interlocking percussion',
    'Make a dark drill beat with sliding 808s and a memorable melody',
    'Create a synthwave track with analog brass and a pulsing bass',
    'Add a contrasting B section and a transition back to the hook',
    'Listen to this song and make three focused improvements',
    'Find some openly licensed field recordings for an organic intro',
    'Make a reggaeton groove with a bright plucked melody',
    'Write a waltz with a music-box theme and warm strings',
    'Create a sparse dub groove with evolving echoes',
  ],
  ask: [
    'Listen to my mix and tell me the three biggest things to fix',
    'Where does this arrangement lose momentum?',
    'Do the kick and bass leave enough room for each other?',
    'What would make the chorus feel more memorable?',
    'Suggest three different directions for the bridge',
    'Is the low end balanced, and is there enough headroom?',
    'Explain the harmony and suggest a surprising next chord',
    'Which sounds could I remove to make the song clearer?',
    'Compare the intro and hook: do they feel like the same song?',
    'Listen for harsh frequencies and overly long reverb tails',
  ],
  midi: [
    'Give this phrase a stronger ending', 'Make the rhythm more syncopated',
    'Simplify it but keep the hook', 'Add passing notes between the main tones',
    'Make it feel more intimate and human', 'Try a call-and-response melody',
    'Make the voicing wider', 'Leave more space between phrases',
    'Add a little tension before it resolves', 'Make it bounce more',
    'Turn this into a delicate arpeggio', 'Make a subtle variation for the next repeat',
  ],
  drums: [
    'Make this section of the intro drumline flow better', 'Add a short fill into the next phrase',
    'Make the hats swing and vary their velocity', 'Add quiet ghost snares',
    'Simplify the kick so the bass has room', 'Give this a halftime feel',
    'Add a brief triplet hat roll', 'Create a one-beat dropout before the downbeat',
    'Make it feel played by a drummer', 'Build energy without adding more kicks',
    'Make the snare more laid-back', 'Add a percussion response to the main groove',
  ],
  audio: [
    'Chop this into a fresh rhythm', 'Make it sit behind the lead',
    'Create a reversed swell into the next bar', 'Give it a warm tape character',
    'Fit the loop to the project tempo', 'Create a spacious dub echo',
    'Make this sound more distant', 'Clean up the low end',
    'Make a stutter at the end of the phrase', 'Tame the sharp peaks without losing punch',
    'Make an airy transition from this sound', 'Try a narrow telephone texture',
  ],
};

/** Fisher–Yates; shuffled on opening / explicit refresh, never while typing. */
export function shuffledSuggestions(kind: SuggestionKind, count = 6, random = Math.random): string[] {
  const pool = [...IDEAS[kind]];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}
