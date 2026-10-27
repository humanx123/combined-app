# Producer quality checks

The producer prompt prioritizes a clear musical brief, a short motif, purposeful
parts, dependable groove, and arrangement contrast. Genre examples are starting
points, not mandatory recipes. Existing phrases and selected notes retain their
scope. Effects and loudness changes need a musical reason.

## What the harness verifies

`ProductionReview` records the sound state at a successful full-mix `listen`.
Subsequent audible edits invalidate that review; names, annotations, and review
markers do not. Solo listens do not qualify as full-mix checks. The evidence is
run-local and supplied outside compacted conversation history. It describes an
excerpt, never claims whole-song coverage, and only requests listening when the
tool is enabled and the result contains playable material. A premature final
answer gets at most one correction request. Missing verification is shown if
the model still stops. Partial provider responses are not accepted as completion.

The critic distinguishes audible observations from uncertain interpretations,
preserves successful elements, and proposes at most two high-impact fixes.
These mechanisms verify workflow, not artistic quality. Automated regression
tests do not establish that listeners prefer the generated music.

## Musical evaluation before changing prompts or models

Compare the previous and candidate version on the same model, project fixtures,
settings, and requests. Use at least three generations per case and blind the
listening order. Record model/version, prompt revision, tool failures, listening
calls, latency, and token usage. Do not put keys or recordings in the report.

## Skills and token cost

`skills.ts` contains six task procedures plus the custom DSP API and seven short
genre guides (emo rap, trap, drill, house, lo-fi/boom bap, R&B/neo-soul, ambient).
The harness attaches at most two relevant task guides and one genre guide. The
model can read another named guide with `get_producer_skill`; it does not receive
the whole genre playbook or custom DSP API on every turn. The live goal and
selection re-route guides when the user steers the run. Skills are guidance, not
permission to bypass Ask mode, selection limits, or explicit user exclusions.

Listening defaults to four bars, capped at 12 seconds. Explicit end bars still
allow up to 60 seconds when a longer review is needed. Critiques request at most
110 words with a 700-token output cap and minimal thinking. Silent renders are
reported from measured levels without a model call. Normal production should
inspect notes/tool warnings first, use one representative mix review, and only
re-listen for a specific unresolved issue. This reduces the default audio sent
and discourages unnecessary round trips; actual billed tokens depend on model,
provider audio handling, task and user settings.

| Request / fixture | Listen and inspect for |
| --- | --- |
| Empty project: “Make an 8-bar warm neo-soul loop, no drums” | Exactly the requested scope; voiced harmony, recognisable motif, space; no unsolicited drums or full song |
| Empty project: “Make a 60-bar melancholy guitar-led beat” | Core loop reviewed before expansion; hook/verse contrast, intentional transitions and ending, bass follows harmony |
| Empty project: “Minimal ambient, no percussion, slowly changing texture” | No trap template; restrained density and effects; evolving texture without arbitrary busy melody |
| Existing mix: “Make the kick clearer without changing the notes” | Notes preserved; specific level/EQ/ducking decision; full-mix review after the last change |
| Selected phrase: “Vary just the last two beats” | Unselected notes and timing identical; coherent variation rather than replacement of the whole clip |
| Uploaded loop plus “Build around this, keep its character” | Audition first, preserve loop identity, fit tempo and harmony without unnecessary layering |
| Steering during generation: “Keep it sparse and remove the extra hats” | Stale calls skipped, plan updated, reduced density audible in the final passage |
| Listening disabled or render fails | Honest limitation; no invented critique, no indefinite review loop |

Score each blind render 1–5 for brief adherence, motif/coherence, groove,
arrangement, palette, and mix. Record concrete timestamps for weak moments.
Prefer a change only when the musical results improve without unacceptable cost
or scope regressions. Neither a longer prompt nor more listening calls alone is
evidence of better music.

## Audio regression

`VoicePool` keeps a fixed number of synth voices. It reuses free voices, then
steals release tails, then the oldest sustained note. This trades an old tail
for the incoming note under overload instead of Tone's dropped-note behavior.
It uses public synth APIs and applies to synth presets, including choir; sampled
instruments and monophonic lead/808 paths retain their existing implementations.

Run `npm test -- src/agent src/engine` and
`npx playwright test tests/e2e/voice-pool.spec.ts --project=desktop`. The browser
test renders dense passages through real Web Audio with a deliberately tiny
two-voice pool across Synth, FMSynth, MonoSynth and AMSynth. It checks late-passage
audio energy, finite output and absence of polyphony-drop warnings. Under real
load, listen for clicks, disappearing tails, and CPU pressure too.
