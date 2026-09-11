@AGENTS.md

# Harry Potter Wand App

## What this is and why

A camera-based, interactive "spell casting" app built for a family camp (6 families,
~11 kids) at the end of September 2026. Kids stand in front of a Mac's webcam; the
Mac is connected to a TV over HDMI so the camera feed (with effects composited on
top) is what the group sees. It's a vibecoding exercise for the app's owner — he's
a ~10yr PHP/backend dev, comfortable in React/Next.js/Nest.js, building this
end-to-end himself with an AI pair.

There is no backend, no database, no auth, no deployment target beyond "runs on this
one Mac during the camp." Everything is client-side: a Next.js page opens the
webcam via `getUserMedia`, runs a couple of MediaPipe ML models in the browser, and
draws the result to a `<canvas>` that fills the screen.

## Stack & running it

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS v4.
- Node 24.20.0 via `nvm` (see `.nvmrc`).
- Dev server runs on port **3001** (not the default 3000):
  ```
  cd harry-potter-wand && source "$HOME/.nvm/nvm.sh" && nvm use 24.20.0 && npm run dev -- -p 3001
  ```
- The dev server does **not** survive a Mac reboot/sleep-wake-with-restart — it has
  to be started manually every time after the machine restarts.
- Always run `npx tsc --noEmit` and `npm run lint` (`eslint`) after any change to
  the game pages before calling something done — both must be clean. Neither has a
  build step involved; Turbopack dev mode picks up file changes immediately.
- No test suite exists or is planned — this is a one-off event app, verification is
  type-checking + linting + manual/live testing with a real camera, hand, and voice.

## Route map

- `/` — home hub. Two activity tiles, extensible list (`ACTIVITIES` in
  `src/app/page.tsx`). Background image is optional and configurable, see
  "Home hub background" below.
- `/kouzla` — setup screen for "Základy kouzel" (spell basics): pick one of the
  images in `public/backgrounds/` and one of `public/patronus/` (click = select,
  yellow border = selected), then a button links to `/kouzla/hra?bg=<id>&patronus=<id>`.
- `/kouzla/hra` — the actual spell-casting game. See "kouzla/hra in detail" below.
- `/bubaci` — setup screen for "Zažeň bubáka" (banish the boggart): pick a boggart
  type (currently only `spiders`), links to `/bubaci/hra?bubak=<id>`.
- `/bubaci/hra` — the boggart mini-game. See "bubaci/hra in detail" below.

Both `*/hra` pages follow the same overall shape: a hidden `<video>` element fed by
`getUserMedia`, a full-screen `<canvas>` that's the only thing actually visible,
`click` anywhere to enter fullscreen, and a `requestAnimationFrame` loop that reads
the current video frame, runs ML inference on it, and redraws the canvas every
frame. Both are "use client" pages with a single big `useEffect` that owns the
camera stream + ML model lifecycles.

## `kouzla/hra` in detail (`src/app/kouzla/hra/page.tsx`)

Loads two MediaPipe models: `HandLandmarker` (21 hand landmarks, tracks the index
fingertip for gesture + spell trail) and `ImageSegmenter` (`selfie_segmenter`,
real-time background replacement). Renders, per frame: chosen background image →
segmented person cut out and drawn on top (mirrored) → spell trail + fingertip dot
(mirrored, drawn with the person) → Patronus effect (screen-space, not mirrored) →
first-spell tutorial arrow / Lumos glow (screen-space, not mirrored).

**Spells** — a swipe gesture (`GestureDetector` in `src/lib/gesture-detector.ts`,
classifies dominant-axis swipe direction with a speed threshold) maps to one of 4
spells via the `SPELLS` constant at the top of the file:
- **down → Lumos** (deliberately paired with the guided tutorial's "wave down" cue)
- left → Nox
- up → Wingardium Leviosa
- right → Expelliarmus

If this mapping is ever revisited, it's a two-line edit in `SPELLS` — no other code
depends on which direction maps to which spell. Every Lumos cast (down-swipe) also
triggers the "lumos glow" — a warm-white `globalCompositeOperation="screen"`
overlay that fades over ~1.5s (`lumosGlowStartRef`) — regardless of tutorial state,
since it's the light spell and should visually light things up every time.

**First-spell guided tutorial** — triggered **only** by pressing **N** (deliberately
manual, not auto-started on page ready, so it can be fired at the exact moment a
child is in position — e.g. while the next kid in line is still getting settled).
`runIntroTutorial()`:
1. Asks the child's name (`askForVocativeName`), greets them ("Ahoj, {vocative}!").
2. Speaks "Teď zkus své první kouzlo! Máchni hůlkou dolů a řekni: Lumos!" and shows
   a hand-drawn (not emoji) pulsing gold arrow — a thin vertical line + triangular
   arrowhead, `tutorialStepRef.current === "guide-down"` — until a down-swipe lands.
   The app does **not** listen for the spoken word "Lumos" — the gesture alone is
   the trigger.
3. On the down-swipe: hides the arrow/instruction text, starts the lumos glow, and
   ~600ms later (so the glow visibly starts first) speaks **and displays** "Skvělé!"
   as a one-time congratulation. This praise is tutorial-only — it does not repeat
   on every subsequent free-play Lumos cast, only the glow does.

Patronus, Patronus voice recognition, background music, and the resource-cleanup
pattern are documented in their own sections below since they're shared concerns
across both `*/hra` pages (well, Patronus is `kouzla/hra`-only, but the resource
pattern isn't).

## `bubaci/hra` in detail (`src/app/bubaci/hra/page.tsx`)

Loads `HandLandmarker` + `FaceLandmarker` (468 face landmarks) — deliberately **no**
`ImageSegmenter` here (no background swap in this activity, just the mirrored raw
camera feed) to save perf, since two ML models + a segmenter was noticeably heavier.

On ready, `runIntro()` fires **automatically** (unlike `kouzla/hra`'s now-manual N
trigger — this asymmetry hasn't been revisited; if the manual-trigger preference
turns out to apply here too, mirror the same pattern). It asks the child's name via
`askForVocativeName`, then speaks a personalized instruction: "{Name}, musíš zahnat
pavouky! Mávni hůlkou do kruhu a odeženeš pavouka." Deliberately **not** a spoken
"Riddikulus" trigger — too hard for kids to pronounce reliably, so a wand gesture
(circle) is the trigger instead, reusing the name-ask flow that already existed.

A `SpiderEffect` (`src/lib/spider-effect.ts`) renders a crawling 🕷️ emoji between 6
curated "safe" face landmark indices (`FACE_ANCHOR_INDICES = [10, 1, 152, 234, 454, 9]`
— forehead, nose tip, chin, left/right face edge, between eyebrows; deliberately
avoids eyes/mouth). `CircleGestureDetector` (`src/lib/circle-gesture-detector.ts`)
detects a circle drawn with the wand tip → `spider.banish()` (shrink+fade) → new
spider spawns after `RESPAWN_DELAY_MS = 700`.

**Circle-gesture detection — why it's not centroid/angle-based**: the first version
summed signed angle around the trail's centroid (trigger at ≥270°) and was too
easily false-triggered by an ordinary left/right swipe, because a natural arm-arc
(elbow/shoulder as pivot) accumulates enough signed angle on its own. The current
version (`circle-gesture-detector.ts`) instead tracks **heading** (direction of
travel) between consecutive smoothed points: a circle's heading rotates gradually
in one direction the whole way around; a swipe's heading reverses sharply (~180°) at
each end. A single per-step turn sharper than `MAX_TURN_PER_STEP` (150°) disqualifies
the gesture outright as "not a circle." The trail is smoothed first (moving average,
`SMOOTHING_RADIUS = 2`) so ordinary hand jitter on a real, wobbly, kid-drawn circle
doesn't get mistaken for a sharp reversal. Verified with 5 synthetic in-browser test
scenarios (clean swipe, clean circle, lightly/heavily noisy circle, up-down swipe) —
if this ever needs retuning, the knobs are all at the top of the file
(`MAX_TURN_PER_STEP`, `MIN_TOTAL_TURN`, `MIN_RADIUS`, `SMOOTHING_RADIUS`).

## Shared library code (`src/lib/`)

- **`gesture-detector.ts`** — `GestureDetector`, 4-direction swipe classifier
  (speed-threshold start/stop, dominant-axis + sign at the end). Used by both game
  pages for the wand-tip trail; `bubaci/hra` only uses it for the trail visuals
  (spell direction doesn't matter there), `kouzla/hra` uses the direction for spells.
- **`circle-gesture-detector.ts`** — `CircleGestureDetector`, heading-based circle
  detector, see above. `bubaci/hra`-only.
- **`background-composite.ts`** — `applyMaskAlpha()`, writes a MediaPipe confidence
  mask directly into a canvas's per-pixel alpha channel (`getImageData`/`putImageData`)
  so the person can be drawn with soft edges over any background. Was extended once
  with a `WandLine` parameter to force a visibility band for a held pencil/wand —
  **that was tried, tested, and explicitly rejected** by the owner ("nevypadá to
  nejlíp" — without a real object in that band it just exposed raw unprocessed
  camera background, which looked wrong) and fully reverted. If wand-visibility
  comes up again, don't redo the same approach without a fresh round of visual
  iteration — the idea (extrapolate the wand tip, force opacity in a band) is sound,
  the execution needs actual design work (softer edge, smaller band, or a different
  visualization entirely).
- **`patronus-effect.ts`** — `PatronusEffect`. `loadShape(url)` cuts the
  background out of a supplied glow-deer image using luminance-as-alpha (auto-detects
  whether the subject is the light or dark pixels), so any reasonably clean image on
  a plain background works with zero manual masking. `trigger()` starts a fade-in
  (600ms) → hold (2200ms) → fade-out (1400ms) sequence with a soft pulsing glow
  (`shadowBlur`, not per-particle gradients — an earlier particle-based version
  caused visible frame stutter). Uses plain alpha blending, not `"lighter"`/additive
  — additive got washed out against the bright Hogwarts sunset background.
- **`spider-effect.ts`** — `SpiderEffect`, see "bubaci/hra in detail" above.
- **`spell-sounds.ts`** — `playSpellSound(id)`, all sounds are synthesized with the
  Web Audio API (oscillator sweeps + short "sparkle" note sequences) — no audio
  files. `SpellId` = `"lumos" | "nox" | "wingardium" | "expelliarmus" | "patronus" | "banish"`.
- **`voice-recognition.ts`** — `normalize()` (lowercase, strip diacritics via NFD +
  combining-mark regex, strip non a-z), `matchesPatronusPhrase()`, and
  `startPatronusListener(onDetected)`. The Patronus listener runs **continuous**
  English (`"en-US"`) recognition (fuzzy-matches "expect...patron/patrn" so accented
  pronunciation still hits) with auto-restart on `onend` unless explicitly
  stopped/paused. Exposes `setPaused()` because the browser's Web Speech API only
  supports one active `SpeechRecognition` session at a time, and the name-greeting
  flow needs the mic too — every voice-input flow that runs one-off recognition
  pauses this listener first and resumes it in a `finally`.
- **`voice-greeting.ts`** — `askForVocativeName(onStatus)`: speaks "Jak se
  jmenuješ?", listens once (`listenOnce`, 6s timeout, Czech `"cs-CZ"`), extracts a
  name from the transcript (`extractName`, strips common Czech "I'm called..."
  prefixes), and declines it into the **vocative case (5th case)** via
  `toVocative()` — a hand-built `KNOWN_VOCATIVES` lookup dictionary (Czech vocative
  declension is irregular, not something worth guessing algorithmically) with an
  `-a → -o` fallback heuristic for unrecognized names, else left unchanged. Returns
  `null` (and speaks an apology) if nothing usable was heard. `runNameGreeting()` is
  a thin wrapper that also speaks the "Ahoj, X!" greeting — kept around but
  superseded in `kouzla/hra` by `runIntroTutorial()`, which calls
  `askForVocativeName` directly so it can chain the tutorial steps after the
  greeting instead of stopping there.
- **`resolve-asset.ts`** — `resolveImageUrl(basePath)`: tries
  `.webp/.jpg/.jpeg/.png` in turn (via `Image.onerror` fallback chaining) and
  resolves with whichever extension actually exists. This is why any image folder
  under `public/` (backgrounds, patronus, menu) can hold a file named just `1`,
  `2`, `background`, etc. in **any** of those formats without touching code.

## Home hub background

`src/app/menu-background.tsx` (`MenuBackground`, client component) resolves
`/menu/background` via `resolveImageUrl` and — if a file exists at
`public/menu/background.{webp,jpg,jpeg,png}` — renders it as a full-bleed image
behind the hub's title/tiles with a `bg-black/60` dark overlay for legibility. If no
such file exists, it renders nothing and the hub keeps its plain black background
(status quo). No code change needed to set/change it, just drop an image in.

**Stacking-context gotcha hit while building this** (worth remembering for any
future full-bleed background-behind-content layout in this app): the background
image/overlay are `position: fixed`/`absolute`. A negative `z-index` on them does
**not** reliably put them behind a sibling/ancestor's own background if that
ancestor doesn't establish its own stacking context — `position: relative` alone
(without a non-auto `z-index`) does *not* create one, so a `-z-10` child can end up
painted behind the *page root's* background instead of just behind its intended
sibling, making it invisible. The fix used here: give the container (`main` in
`page.tsx`) the Tailwind `isolate` class (`isolation: isolate`, forces a new
stacking context), then use non-negative `z-0` for the background layer and
`relative z-10` for the foreground content — all comparisons then happen locally
and predictably within that one container.

## Resource-cleanup pattern (both `*/hra` pages)

React Strict Mode mounts every effect twice in dev. If an async `init()` (acquiring
`getUserMedia`, `HandLandmarker`, `ImageSegmenter`/`FaceLandmarker`) is still
awaiting when the *first* mount's cleanup already ran, the resource resolves into
existence *after* cleanup — the outer `return () => {...}` never sees it, so it
leaks forever. Across enough dev-mode refreshes this piles up until the tab
reports "page unresponsive" (this actually happened and was traced back to this
exact cause once Patronus/audio were added and made init() slower).

The fix, present in both game pages, and worth preserving in **any** new page that
acquires camera/ML resources: idempotent `release*()` helpers (null-guard + null
out) for each resource, called at **every** `if (cancelled) { ...; return; }`
checkpoint inside `init()` — not just once in the effect's final cleanup. Any
`setTimeout`/interval started inside the effect needs the same treatment (tracked
in a closure variable, cleared in the same cleanup).

## Mirroring

The camera feed is naturally "wrong way round" for a self-view. Only the
person/hand/wand-trail layer should be mirrored — background images and
screen-space overlays (Patronus, tutorial arrow, lumos glow, spell-name text) must
stay in their real orientation. This is done with `ctx.save()` /
`ctx.scale(-1, 1)` / `ctx.translate(-canvas.width, 0)` around just that layer, then
`ctx.restore()` before drawing anything screen-space. (`bubaci/hra` mirrors
*everything* including the spider, since there's no separate background layer to
keep unmirrored there — a deliberate simplification, not an oversight.)

## Autoplay / audio

Browsers block audio (background music, and to a lesser extent
speech-synthesis-adjacent flows) from starting without a real user gesture. Both
music start and fullscreen are tied to the same `onClick` handler on `<main>` as a
guaranteed fallback, plus a best-effort automatic attempt once `status === "ready"`
that silently no-ops if the browser blocks it.

## Assets (`public/`)

- `backgrounds/1.*`, `backgrounds/2.*` — Hogwarts-style images for `kouzla/hra`.
  **`2.*` is currently still a placeholder copy of `1.*`** — swap in a real second
  image whenever it's available, any supported extension, no code change needed.
- `patronus/1.*`, `patronus/2.*` — glow-deer-style source images for the Patronus
  effect. Both are real images now (one webp, one jpeg).
- `music/background.mp3` — 315s track for `kouzla/hra`'s background music, played
  at volume `0.35`, looped over just the first `MUSIC_LOOP_END_SECONDS` (2:20 =
  140s) via an `onTimeUpdate` handler that resets `currentTime` — the file itself
  was never trimmed, the loop point is purely in-app. Not used in `bubaci/hra` at
  all yet (could be added the same way if wanted).
- `menu/background.*` — optional, see "Home hub background" above. Doesn't exist by
  default.

## Known open items / things awaiting live confirmation

- The down/right spell swap (down=Lumos, right=Expelliarmus) and the guided
  first-spell tutorial (arrow, glow, "Skvělé!") have been visually verified via
  browser automation (camera worked in that session) but not yet fully verified
  with a real hand swinging a real wand end-to-end by the owner.
- The circle-gesture fix in `bubaci/hra` is verified only via synthetic
  in-browser test data, not yet confirmed with a real kid-drawn circle.
- `backgrounds/2.jpg` is a placeholder — needs a real second Hogwarts-style image.
- `layout.tsx` still has the default `create-next-app` metadata (`title: "Create
  Next App"`) — never customized, purely cosmetic (browser tab title), harmless.
- Ideas discussed but not built: house points system, a Sorting Hat activity, more
  boggart types beyond spiders, background music in `bubaci/hra`.
- The Mac this runs on has had recurring swap/memory pressure (dev server getting
  killed by "system low on memory", swap seen at 93-95% full). A full restart
  fixed it before; if the dev server keeps dying immediately after restart, that's
  the first thing to check (`sysctl vm.swapusage`) rather than assuming a code
  regression.
