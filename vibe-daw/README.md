<h1><picture><source media="(prefers-color-scheme: dark)" srcset="public/brand/wordmark.svg"><img src="public/brand/wordmark-light.svg" alt="Vibe" height="96"></picture></h1>

The open source agentic DAW built to enhance, not replace, human creativity.

[vibedaw.org](https://vibedaw.org/)

Vibe is a full digital audio workstation - arrangement, piano roll, step sequencer, mixer, effects - with a producer agent built in. Type *"make a simple boom bap drumline"* and it plans the track, picks and **listens to** sounds, writes the parts, arranges and mixes them, then bounces the song and listens back to fix what it hears. Everything it does is ordinary DAW state: you can edit any of it by hand, and one undo takes back a whole agent run.

It's Cursor for music: the agent edits your session the way Cursor edits your code, with reviewable changes, checkpoints, and inline edits on a selection.

## What makes it agent-native

- **Ears, not just eyes.** Gemini is multimodal, so the agent auditions samples and critiques real offline bounces of your song (rendered by the same engine you hear), paired with measured loudness, spectrum balance, and stereo data.
- **A DAW API built for a model.** Tools speak producer: step-string drum patterns with trap rolls (`x.x.3.4.`), chord symbols with strum/arpeggio/voice-leading, 1-based bars, `copy_bars`/`clear_bars` arrangement moves, sidechain ducking, sound design, resampling.
- **No generated audio.** Every sound is a real instrument, your own samples, or something synthesized from parameters. The agent composes and produces; it never prints audio from a text prompt.
- **Review like code.** Agent-made clips are outlined in the brand gradient until you **Keep** them. Each run ends with a change summary and **Undo all**; every message has a checkpoint you can restore.
- **Ctrl+K inline edits.** Shift-drag a region across tracks or select notes, then press Ctrl+K, say "add hi-hat rolls" or "make it sadder" - the agent receives exact note IDs and timing and can rewrite just that phrase. Touch screens have Range / Select controls and an Edit selection button.
- **Reference tracks.** Attach a song; the agent listens and extracts a production recipe (tempo feel, drum placement, 808 behavior, mix character) to work from.
- **Agent and Ask modes.** Ask mode is read-only: it listens and gives notes without touching the session.

## Quick start

```bash
npm ci
cp .env.example .env.local   # optional: set VITE_GEMINI_API_KEY for local dev
npm run dev                  # landing: http://localhost:5173; studio: /studio
```

No key in the env? The first time you message the agent it asks for a Gemini API key from [AI Studio](https://aistudio.google.com/apikey) (free tier available). The key is saved in your browser and used for requests to Google; when signed in, AI settings also sync through your private account preferences.

By default every build is **bring-your-own-key**, so a public deployment costs the host nothing for AI. Set `VITE_HOSTED_AI=true` to instead route Gemini through Firebase AI Logic on the host's project.

Everything works offline except AI features and the streamed multisampled instruments (piano, guitars, strings, flute…), which download on first use. Projects autosave to IndexedDB.

```bash
npm test          # unit tests (theory, editing ops, analysis, diffs)
npm run typecheck
npm run build
```

The wordmark and mark are drawn in code in `src/brand/glyphs.ts`: each letter is its own stroked path, so weight, spacing, and color are a one-line change. `npm run brand` re-exports `public/brand` (each letter, the wordmark, the mark, and the social card) and the favicons from it.

Refresh the landing page images from the live studio with `npm run screenshots` (start `npm run dev` first). Then run `npm run promo` to frame all six captures as 2400 × 1600 PNGs in `public/promo`, including a contact sheet. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a system Chromium.

## Sounds and workflow

Vibe includes offline Analog Brass, FM Bass, Marimba, Kalimba, Chip Keys, and Glass Pad alongside the existing instruments. Use the four-band Parametric EQ for precise tone shaping; duplicate effects or move them through the chain. The Producer can reorder effects too.

**Custom effects**: write your own DSP in JavaScript, with your own knobs, from **Add effect → Custom** (or ask the Producer to build one). Code is test-run in a sandbox before it reaches playback, then runs on the audio thread in an AudioWorklet and travels inside the project, so bounces and shared projects sound the same. **Save as plugin** keeps it in your library, synced to your account, under **Add effect → Your plugins**.

The **Online** sound-browser tab and the Producer's `search_online_sounds` / `import_online_sound` tools search Wikimedia Commons without an API key. Imports retain authorship, license, and source, including in portable `.vibe` projects. Use **Export → Sound credits (.txt)** when sharing a song; check each source's license requirements. Online imports are limited to 16 MB / three minutes each.

Save phrases, instrument/kit sounds, samples, effect profiles and full project templates in the **Library** tab. Device items work offline; signed-in libraries sync to the account, including audio. **Settings → AI → Custom instructions** applies your preferences across chats. Import standard MIDI files as editable tracks.

Use **Notes & lyrics** to place production notes and timed lyrics anywhere in the arrangement, even without a vocal track. The Producer can read and edit them; export lyrics as LRC. Type **@** in chat or use **Add to chat** / right-click to reference tracks, clips, effects, sounds, cues, library items and Producer reviews. See [studio workflows and remaining production gaps](docs/studio-workflows.md).

Producer and inline suggestions draw from a varied shuffled pool. **More ideas** refreshes the choices without changing your typed request.

See [audio performance and browser checks](docs/audio-performance.md), and [landing-page donation configuration / automatic Firebase rules deployment](docs/deployment.md).

## Models

| Model | Use |
| --- | --- |
| `gemini-3.8-flash` (default) | Agent brain and ears. Fast, strong at tool use. |
| `gemini-4-argon` | Most capable; best musical judgment. Needs a billing-enabled (Blaze) project. |
| `gemini-3.5-flash-lite` | Cheapest and fastest; good for small edits. |

Pick the model and thinking level in Settings or from the composer.

## Production setup (Firebase + Netlify)

Firebase provides sign-in and cloud sync: projects, samples, your Gemini key, AI settings, theme and keyboard shortcuts follow your Google account across devices. If you opt into hosted AI (`VITE_HOSTED_AI=true`), chat and listening go through **Firebase AI Logic** on your project, and **App Check** keeps other sites from spending your quota.

### 1. Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com) and add a **Web app**. Copy its config.
2. **Authentication** → enable the **Google** provider. Add your Netlify domain under *Authorized domains*.
3. **Firestore** → create a database. **Storage** → create the default bucket.
4. **AI Logic** → get started with the **Gemini Developer API**. (`gemini-4-argon` needs the Blaze plan.)
5. **App Check** → register the web app with **reCAPTCHA Enterprise**, copy the site key, and enforce App Check for AI Logic, Firestore, Storage, and Functions once it's working.
6. Configure [automatic rules deployment via GitHub OIDC](docs/deployment.md#automatic-firebase-rules-deployments), or deploy locally:

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc     # put your project id in it
firebase deploy --only firestore:rules,storage
```

### 2. Netlify

1. New site from this repo. `netlify.toml` already sets the build (`npm run build`, publish `dist`, SPA redirects, asset caching).
2. Site settings → Environment variables: add every `VITE_FIREBASE_*` value and `VITE_RECAPTCHA_SITE_KEY`.
3. **Do not set `VITE_GEMINI_API_KEY` on Netlify** - Vite inlines `VITE_*` values into the public bundle.

## Architecture

```
src/
  model/      Project document (types), music theory, catalog of instruments/effects,
              pure editing ops (slice/copy/clear ranges, step patterns, chord voicing)
  state/      Zustand stores: project + snapshot undo history, transport, settings, persistence
  engine/     Tone.js engine. EngineGraph turns a Project into a live graph and drives both
              realtime playback and offline bounces; instruments, effects, WAV encode
  samples/    Procedurally synthesized built-in kit, sample library (IndexedDB),
              DSP analysis (tempo, key, pitch, loudness, spectrum)
  agent/      Gemini client (direct key or Firebase AI Logic), agent loop, tools,
              system prompt, ears (render → Gemini), change diffs
  cloud/      Firebase: auth, Firestore project + preference sync, Storage sample sync
  ui/         React UI: arrangement, piano roll, drum grid, audio clip editor, mixer,
              track inspector, agent panel, Ctrl+K inline edit
```

How a run works: the user's message plus a compact text snapshot of the session goes to Gemini with the tool declarations. The model calls tools (often several per turn); each tool validates input and edits the project through the same store the UI uses, inside one undo transaction. `listen` and `audition_samples` render audio offline and make a separate Gemini call that hears it, returning a critique plus measurements. When the model answers in plain text, the run ends and the change summary appears for review. Gemini 3+ thought signatures are passed back untouched.

## Keyboard

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| Home | Stop and return to start |
| L | Toggle loop (Shift-drag the ruler to set it) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+K | Edit selected notes, region, or clips with AI |
| Shift-drag track lanes | Select a region across tracks (ruler sets the loop) |
| Ctrl+L | Focus the agent |
| Ctrl+D | Duplicate selected clips (or notes in the piano roll) |
| Delete | Delete selected clips / notes |
| Alt-drag | Copy a clip |
| Ctrl+scroll | Zoom the arrangement |

## Policies and accounts

Terms and Privacy pages are generated from `legal/operator.json` with `node scripts/generate-policies.mjs legal/operator.json`. The Netlify check verifies the operator details and signup version before deploying. New Google sign-ins require adult confirmation and agreement, saved privately as a server-timestamped record at `users/{uid}/legal/current`. AI has a separate per-browser acknowledgement covering Google processing, age, professional/business use, and regional billing requirements. See `docs/privacy-operations.md` for privacy request handling and `legal/versions/` for policy copies.

## Credits

- [Tone.js](https://tonejs.github.io) (MIT) powers the audio engine.
- Piano: [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC-BY 3.0), via tonejs.github.io.
- Guitars, bass, strings, flute, harp, organ, xylophone: [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholaus Brosowsky (CC-BY 3.0).
- All drums, 808s, effects, and textures are synthesized in the browser by Vibe - royalty-free.

## Support Vibe

Vibe is free and always will be. If it helps you make something, you can support it with a donation. Donations are optional. Send only the matching coin to each address.

| Coin | Address |
| --- | --- |
| Bitcoin (BTC) | `bc1qgsc2jtrqs2l6ssujsvdzeuhz90tlhgdkvx2pw6` |
| Monero (XMR) | `86Cd2nebXGacoZboCPD9LUdC3BQvJZS4ADoHC4g32Yj82jrJYGqBQ6cFSWj3fnLESV13Tf8FEG5fwBc67jfdoQ1MTrGpu2u` |

A star or a pull request helps too.

MIT licensed. See [LICENSE](LICENSE).
