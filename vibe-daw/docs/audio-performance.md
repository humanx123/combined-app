# Browser audio performance and verification

Vibe uses the same Web Audio / Tone graph for playback and offline export. Existing completed track freezes are reused by playback and bounces. New synths and Parametric EQ use that graph too; there is no separate export-only instrument implementation.

## Resource policy

`src/engine/budget.ts` centralizes the device policy:

- Desktop Chromium: up to four rendering/encoding workers, leaving a CPU core available; reduce concurrency as output PCM grows.
- Mobile browsers, WebKit (including iOS Chrome/Firefox), touch-enabled iPad desktop UAs, and devices reporting at most 4 GB memory: one worker/context at a time and a 64 MiB freeze cache.
- Account for the stereo mix and master copy before creating parallel stems. Constrained devices use a single render pass to avoid full-song stem/mix copies.
- Freeze, listening, and export jobs share a native render queue so concurrent operations cannot each consume the full context budget.
- Freeze jobs check memory before allocating native contexts, retain the existing 64 MiB in-flight ceiling, and release invalid cached audio before reserving replacements.
- Very large offline outputs fail with an actionable memory-budget error before allocation (128 MiB output on constrained devices, 512 MiB on desktop). Long arrangements still play live if they cannot be frozen. These are conservative application limits, not guarantees about a browser's available memory.
- WAV 16/24-bit conversion runs in a dedicated worker with transferable PCM buffers. MP3 already uses workers and now shares the device concurrency policy.
- Annotation/lyric edits bypass graph synchronization; they do not interrupt playback or invalidate freezes.
- The landing page lazily loads the workstation; it never initializes audio, Firebase, AI, or project storage.
- Shared resets/theme tokens load with the landing page; workstation CSS loads with the studio. The initial production stylesheet is 16.61 kB (4.90 kB gzip), down from 75.13 kB (16.69 kB gzip).
- The effects inspector reads a lightweight error store, so opening the studio does not import Tone or the DSP graph before an audio gesture.
- Procedural kit synthesis shares the native render queue, avoiding 32 simultaneous offline contexts during startup. The generated sounds and normalization are unchanged.
- Landing aurora blobs move as individually composited blurred layers. Decorative CSS and SVG animations pause outside a 160px viewport margin and while the document is hidden; reduced-motion preferences still apply. Section reveals finish near the viewport edge, including after rotating a phone to landscape.
- Timeline and piano-roll playheads subscribe directly to transport position and move with transforms; the transport text updates only when its displayed sixteenth changes. Meters clip a fixed gradient instead of changing layout height, and the stereo master is sampled once per frame.
- Waveform peaks are shared by decoded buffer identity, including reversed copies, and released with their buffers. Moving or renaming an audio clip does not redraw its waveform. MIDI previews retain their note drawings through unrelated track changes.
- Completed Producer messages retain their rendered content while typing or streaming another reply. Cloud sample snapshots notify the UI and engine once per batch.
- Drum-editor hit lookup is indexed once per edit/resolution rather than scanning every note for every visible step.

Do not replace native DSP without measurement. Native offline audio threads, cached frozen buffers and bounded scheduling already provide a strong browser foundation.

## Checks

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

For a system Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. CI installs the matching Playwright browser automatically.

The browser suite covers desktop and mobile-sized Chromium, the landing route's lazy-loading boundary, Shift-drag selection inside a clip, touch Select/Range controls, piano/drum selection, six new offline instruments through Parametric EQ, WAV encoding/decoding, and playback during edits. It also automates the existing freeze-buffer and live/frozen export parity fixtures. Tests use real browser audio APIs without AI keys.

Mobile emulation exercises touch layout, UA resource policy and browser behavior; it is not a hardware benchmark or a substitute for physical iOS/Android testing. Large projects, sample downloads, browser thermal throttling and available memory can dominate real-world results. The manual DSP fixtures remain under `tests/browser/` for profiling on target hardware.

`tests/e2e/performance.spec.ts` guards lazy style/audio loading, bounded startup synthesis, offscreen CSS/SVG pausing, landscape reveals at 844×390, 932×430 and 667×375, waveform redraw invalidation, and playhead coordinates after seeking and zooming. For profiling, use a production preview with service workers disabled, the same viewport/DPR and CPU throttle before/after, and record both main-thread work and frame timing; emulated frame rates alone do not predict phone hardware performance.

The studio suite also covers library persistence/reuse/templates, custom instructions, MIDI file import, timed writing cues without vocal tracks, Producer review scrolling, equivalent click/right-click/mention attachments, and measured tooltip bounds at interface zoom. Firestore ownership and library sync conflicts have separate emulator/unit coverage; no live account or Gemini requests are needed.
