import { CUSTOM_EFFECT_API } from '../model/customEffect';

/** Small, procedural skills. Only the relevant task/genre is sent on each turn. */
export const PRODUCER_SKILLS = {
  compose: `COMPOSE A PHRASE OR LOOP
1. Read the request's length, style, instruments and exclusions. Inspect existing notes with get_notes if building on a clip. Do not change existing tempo/key without a reason.
2. Choose one chord rhythm and a 1–2 bar motif. Write its rhythm first: attacks, rests, strong notes and ending. Use a small pitch set; chord tones on important beats are a reliable starting point, not a prohibition on dissonance.
3. create_track returns the actual track id. Pass that id to write_notes; never guess ids. Set start_bar and length_bars. notes use pitch, start, duration, velocity; chords use chord, start, duration and optionally octave/voicing/arp. Note start/duration are beats RELATIVE TO THE CLIP, not song bars. In 4/4 an 8-bar clip is 32 beats; a note in its second bar starts at beat 4. Keep starts inside the clip and durations within its end.
4. Use voicing=voice_lead for smooth chord changes, or explicit notes for control. Make a response or alternate ending instead of copying the motif unchanged. Bass follows the actual chord at that moment, not just the song's tonic.
5. Inspect tool warnings and notes for register, clashes, density and correct length. Fix one weak part before adding another. A loop request ends at the requested loop; do not expand it into a song.
DONE: correct scope, a recognisable idea, deliberate rests, connected harmony and no unresolved tool errors.`,
  rhythm: `DRUMS AND BASS
1. Decide straight vs swung, beat unit and half/double-time feel before programming. create_track kind=drums, then write_drums with lanes containing lane, pattern, steps_per_bar and velocity.
2. Count each pattern's steps. In 4/4 at 16 steps/bar, beat 1 is index 0, beat 2 index 4, beat 3 index 8, beat 4 index 12. x=hit, X=accent, o=ghost, .=rest. Beat-3 half-time snare: "........x.......". Beats-2-and-4 backbeat: "....x.......x...". These are different grooves. Do not mix 16- and 32-step strings without setting their lane resolution explicitly.
3. Establish kick/backbeat first. Add hats with accents and gaps; add only an occasional fill that points into the next phrase. Do not randomize every hit or put a roll at every bar end.
4. Write bass with write_notes on a pitched instrument track, normally octave 1–2. Match chord changes and leave room around kick transients. For bass808, overlapping durations create slides: deliberate phrase-end overlaps only, not every note.
5. Inspect kick/bass alignment and hat density before adding effects. Audition a candidate sample only when its timbre is uncertain or user-uploaded audio must be understood; do not audition every known built-in hit.
DONE: intentional backbeat, consistent pulse, bass harmony correct, kick/bass space, variation with restraint.`,
  arrange: `ARRANGE EXISTING MATERIAL
1. Read existing clips and sections; establish requested start/end bars. Get a working core phrase before copying it. Do not silently turn an 8-bar request into 64 bars.
2. Define sections with start_bar and length_bars. Make the arithmetic add up without accidental gaps or overlaps. Plan at least one contrast: drop a part, change register/rhythm, or answer the hook.
3. copy_bars uses [from_bar,to_bar), so bars 1 through 8 mean from_bar=1,to_bar=9. dest_bar is the new start. It OVERWRITES destination content; inspect it first and limit track_ids. clear_bars is destructive too; never clear all tracks when only one layer should drop out.
4. After copying, change something musically meaningful in each different section; labels alone do not create variation. Use set_sections to label the real boundaries, then inspect entrances and the ending.
5. A final short listen should cover the changed transition or strongest representative section, not automatically the intro. Do not claim the whole song was heard from one excerpt.
DONE: requested length, real section contrast, purposeful transitions/ending, existing work preserved.`,
  mix: `REPAIR A MIX WITHOUT REWRITING IT
1. Identify the exact symptom and tracks/bars. Inspect current gain, mute/solo, effects and notes before changing anything. Preserve composition and timing unless requested.
2. Choose ONE hypothesis: level imbalance, masking, bass/kick overlap, harshness, excess ambience or stereo problem. Use a short listen only if the answer requires hearing it; ask a focused question.
3. Make the smallest relevant change with update_track or update_effect. Lower a masking source before raising everything. Track fader numbers alone do not measure loudness. Avoid automatic reverb, widening, compression and master limiting.
4. Use the returned measurements and concrete hearing evidence. Do not invent EQ frequencies or clipping. A quiet peak is not an error. Keep kick/sub centred; intentional distortion or sparse dynamics may be correct.
5. Re-listen only when the first finding is unresolved or a substantial correction needs confirmation. Do not re-render for a renamed track or checklist update.
DONE: targeted symptom addressed, no unrelated edits, measured/audible evidence distinguished from guesses.`,
  selection: `EDIT ONLY THE SELECTED PHRASE
1. Read <selection> and its note ids/range. If needed call get_notes for that clip. Preserve every unselected note, clip and track.
2. Use replace_selected_notes for a rewritten selected phrase, or transform_notes with note_ids for a specific transformation. Never use write_notes to replace the whole clip for a partial edit.
3. Calculate positions in beats relative to the existing clip, not the song. Keep the phrase's start/end and intended rhythm unless asked to move them. Change one dimension at a time: pitch contour, ending, rhythm or articulation.
4. Inspect the changed notes and compare to the neighbouring phrase. A tiny deterministic transpose/velocity change usually needs note inspection rather than repeated audio analysis.
DONE: requested change inside selection, other notes unchanged, no surprise arrangement/tempo edits.`,
  sound_design: `DESIGN A SOUND
1. Identify the audible target and the sound's role/register. Start from the closest existing preset or built-in effect; inspect its parameters. Change only knobs supported by that preset/effect.
2. Adjust envelope/timbre first, then audition in context if needed. Avoid adding layers to compensate for a wrong register or envelope.
3. Use design_sound for synthesized one-shots; it is not text-to-song generation. For a user-requested custom DSP plugin, read get_producer_skill(name="custom_effect") BEFORE writing code. Read existing plugin code with get_custom_effect before editing it.
4. Fix validation errors before claiming success. Save to the reusable library only if the user asked to save it.
DONE: target character, playable register, sensible envelope, safe levels, no unsupported parameters.`,
  custom_effect: `CUSTOM DSP PLUGIN
Use built-ins unless the user wants custom DSP or they cannot achieve the target. Specify the intended effect and its controls; provide clear labels, units, musical ranges, unity gain and a Mix control for coloration. Tool validation test-runs code; repair returned errors rather than repeatedly submitting identical code. Never overwrite an existing plugin before reading its code. Only save persistently when requested.
${CUSTOM_EFFECT_API}`,
} as const;

export type ProducerSkill = keyof typeof PRODUCER_SKILLS;

export const GENRE_SKILLS = {
  emo: `EMO RAP: 140–160 BPM often feels half-time at 70–80. Prioritise a melancholy guitar/piano motif and vocal space. Choose a small harmonic loop and varied articulation, not a wall of reverb. Snare on beat 3 at double-time; sparse kick, restrained hats; bass follows chord roots with occasional deliberate slide. Contrast verse/hook by density. The user's reference overrides this starting point.`,
  trap: `TRAP: pick the perceived half-time feel before setting tempo (often 130–160 double-time). Snare/clap on beat 3, syncopated kick, hats with a few strategically placed rolls. Write the main motif before filling percussion. Bass808 roots follow chord rhythm; isolate slides to phrase ends. Reserve low end for kick/bass; contrast sections by subtraction.`,
  drill: `DRILL: often 140–145 BPM with a half-time backbeat and syncopation. Use a short dark motif and sparse harmony. Choose 12/24-step lanes deliberately for triplets; do not treat a 16-step pattern as triplet timing. 808 slides need overlapping pitched notes and rhythmic space; do not slide every note. Keep enough rests for the groove.`,
  house: `HOUSE: often 120–128 BPM. Four-on-the-floor kick at 0,1,2,3 quarter-note beats, claps on 2/4, offbeat open hat. Bass and chord stabs should interact, not merely duplicate roots on every kick. Use short motifs and meaningful 8/16-bar development. Sidechain only the parts that need room; do not widen sub bass.`,
  lofi: `LO-FI / BOOM BAP: choose slow pulse (roughly 70–95 BPM), backbeat on 2/4, and coherent swing. Warm voiced harmony, a small melodic idea and bass that follows it. Ghost notes and velocity contrast matter more than random offsets. Dust/noise are optional textures, not a substitute for groove. Leave headroom and avoid drowning the hook in effects.`,
  soul: `R&B / NEO-SOUL: focus on voiced 7th/9th harmony, clear bass movement, syncopated but spacious rhythm and a singable motif. Move inner chord voices smoothly. Use fills as responses to the hook. Do not equate complexity with more simultaneous notes; preserve vocal space and choose percussion to match the requested feel.`,
  ambient: `AMBIENT: obey requests for no drums/beat. Let sustained harmony, register, slow entrances and texture carry development. Use a few complementary sounds, deliberately long envelopes and controlled low end. Avoid busy scale runs and uniform block-chord retriggers. Listen to a representative texture only when balance or artifacts need evaluation.`,
} as const;

export function productionSkills(request: string, selected = false): string {
  const tasks: ProducerSkill[] = [];
  if (selected) tasks.push('selection');
  if (/\b(mix|master|muddy|harsh|quieter|louder|balance|masking|eq|compress)\b/i.test(request)) tasks.push('mix');
  if (/\b(plugin|sound design|design a sound|custom effect|synthesiz)/i.test(request)) tasks.push('sound_design');
  if (/\b(bass|808)\b/i.test(request) || (/\b(drums?|kick|snare|hats?|groove)\b/i.test(request) && !/\b(no drums|no percussion)\b/i.test(request))) tasks.push('rhythm');
  if (/\b(arrange|arrangement|full song|full beat|bridge|verse|chorus|outro|transition)\b/i.test(request)) tasks.push('arrange');
  if ((!tasks.length && /\b(make|write|create|build|compose|improve|beat|melody|chords?|loop|song|music)\b/i.test(request)) || (tasks.length && !selected && !tasks.includes('mix') && !tasks.includes('sound_design'))) tasks.push('compose');
  const genre = /\b(peep|emo|juice wrld)\b/i.test(request) ? 'emo'
    : /\bdrill\b/i.test(request) ? 'drill'
    : /\bhouse\b/i.test(request) ? 'house'
    : /\b(lo[ -]?fi|boom bap)\b/i.test(request) ? 'lofi'
    : /\b(neo[ -]?soul|r&b|rnb)\b/i.test(request) ? 'soul'
    : /\bambient\b/i.test(request) ? 'ambient'
    : /\btrap\b/i.test(request) ? 'trap' : null;
  if (genre && !selected && !tasks.includes('mix') && !tasks.includes('sound_design') && !tasks.includes('arrange') && !/\b(no drums|no percussion|melody only|chords only)\b/i.test(request) && genre !== 'ambient') tasks.push('rhythm');
  return `<producer_skills>\n${[...new Set(tasks)].slice(0, 2).map((id) => PRODUCER_SKILLS[id]).join('\n\n')}${genre ? `\n\n${GENRE_SKILLS[genre]}` : ''}\n</producer_skills>`;
}
