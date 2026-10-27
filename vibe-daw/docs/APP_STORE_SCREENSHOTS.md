# App Store screenshots

A manual pipeline, run on your own machine against the local dev server (it
never runs in CI). It is a port of ChatRPE's `scripts/generate-screenshots.js`:
the same poster renderer (tilted device, a pop-out lifted from the real screen,
one listing-wide scene that runs across the seams), cut down to the two sizes
App Store Connect requires.

`scripts/screenshots/` holds:

- `story.cjs`: Vibe's own part. Listing order, headlines, how each screen
  is reached, the readiness check each screen must pass, and the brand
  (colours, display font, background motif).
- `generate.cjs`, `poster.cjs`, `status-bar.cjs`: the engine, identical in
  Lacuna, MusicTheory.Work and Vibe. Change it in one repo, copy it to the others.
- `fonts/`: the brand faces (variable, with italics), vendored (SIL Open Font
  License) so framing never waits on the network.

## Run it

Start the app, then:

```sh
npm run dev
npm run appstore-screenshots -- --plan                 # what will run, writes nothing
npm run appstore-screenshots                           # capture + frame everything
npm run appstore-screenshots -- --frame-only           # re-frame from raws, no server needed
npm run appstore-screenshots -- --device=ipad-13 --shot=producer
```

`BASE_URL` overrides the dev server address (default `http://127.0.0.1:5173`), and
`CHROME_PATH` the Chrome install (it drives the installed Chrome through
playwright-core, so there is no browser download). `--headed` shows the
browser while it captures.

## Sizes

Only the required ones: iPhone 6.9" (1320x2868), iPhone 6.3" (1206x2622,
App Store Connect's "6.1" or 6.3"" slot) and iPad 13" (2064x2752).
App Store Connect scales these down for every smaller display class.

## Output

- `screenshots/raw/<device>/<shot>.png`, plus `<shot>.popout.json`, the rect
  of the element the poster lifts out.
- `screenshots/appstore/iPhone 6.9 inch/`, `iPhone 6.3 inch/` and `iPad 13 inch/`:
  the upload sets, numbered in listing order. A full run replaces the set; a `--shot` run
  leaves the others in place and recomposes its neighbours so seams still line up.
- `screenshots/appstore/creative/`: the product page header (21:9, 3840x1646),
  the search result image (3:2, 3840x2560) and the universal asset (16:9,
  5244x2950), from the 6.9" captures. Each is the brand block beside whole,
  upright phones, kept inside the area every crop keeps.

`/screenshots` is gitignored. Look at every image before you upload.

## The listing

- The first image is the brand alone: the wordmark and the tagline the landing
  page leads with, on the listing canvas. The header and search images reuse
  the same brand block.
- Every other image is one feature. Its caption says what you get, in plain
  words (no slogans), with the key words in the brand accent.
- Phones are large and whole: no composition shrinks a phone to fit a
  headline, and a pop-out never shoves a phone off the canvas.

## Safe areas

The capture viewport leaves out the iOS status bar and Dynamic Island at the
top and the home indicator and rounded corners at the bottom, as a device
does, so nothing the app draws sits under them. The poster draws the status
bar and home indicator in those bands, filled with the app's own edge colour,
and the capture fills the screen between them with no bars.

## Capture rules

- Each shot gets a fresh browser context, an iOS Safari user agent, reduced
  motion, and a fixed locale and timezone.
- Nothing is captured mid-load. Each shot has a `ready()` check, then the page
  must have its fonts and images loaded, show no loading indicators, and keep
  the DOM still for 700ms. `ready()` runs again as an assertion right before
  the shutter.
- A pop-out must be at least 95% on screen or the capture fails. It never
  ships cut off.
- Dev tooling (the Next.js badge, the Vite overlay) is hidden on every page.

## Vibe specifics

- Every shot builds the "Late night drive" demo session through the
  Producer's own tools (`scripts/lib/demo-session.mjs`, shared with the
  landing captures in `capture-landing-screenshots.mjs`). No model is called;
  the Producer chat is seeded with real tool results.
- Panels open the way a person opens them: the Producer toggle, the dock's
  Collapse button, dragging the dock handle, Ctrl+K.

