@AGENTS.md

# Harry Potter Wand App

## What this is and why

A camera-based, interactive "spell casting" app built for a family camp (6 families,
~11 kids) at the end of September 2026. Kids stand in front of a Mac's webcam; the
Mac is connected to a TV over HDMI so the camera feed (with effects composited on
top) is what the group sees. It's a vibecoding exercise for the app's owner — he's
a ~10yr PHP/backend dev, comfortable in React/Next.js/Nest.js, building this
end-to-end himself with an AI pair.

There is no database, no auth, no deployment target beyond "runs on this one Mac
during the camp." Almost everything is client-side: a Next.js page opens the
webcam via `getUserMedia`, runs a couple of MediaPipe ML models in the browser, and
draws the result to a `<canvas>` that fills the screen. The one exception is a
single local API route that toggles a real physical lamp for the Lumos/Nox spells
— see "HomeKit lamp integration" below — which is still just this one Mac talking
to itself, not a real backend.

## Stack & running it

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS v4.
- Node 24.20.0 via `nvm` (see `.nvmrc`).
- Dev server runs on port **3001** (not the default 3000):
  ```
  cd harry-potter-wand && source "$HOME/.nvm/nvm.sh" && nvm use 24.20.0 && npm run dev -- -p 3001
  ```
- **For the camp itself, run the production build, not dev**: `npm run camp`
  (= `npm run build && npm run start`, `start` is pinned to `-p 3001`). Much
  lower memory use (this Mac has had swap pressure), no Strict Mode double
  mounts, no dev error overlay. A production server does *not* pick up code
  changes — stop it, rebuild, restart. `next build` requires a `<Suspense>`
  boundary around anything using `useSearchParams()`, which is why every
  `*/hra` page's default export is a thin Suspense wrapper around a
  `*Inner` component.
- **Offline**: MediaPipe WASM + all three models are served locally from
  `public/mediapipe/` (gitignored, ~45MB) via `src/lib/mediapipe-assets.ts`
  — never from jsdelivr/googleapis. `scripts/fetch-mediapipe-assets.mjs`
  populates it (runs on `postinstall` and `prebuild`, or `npm run
  fetch-assets`). `public/mediapipe/**` is in eslint's ignores. **What still
  needs internet**: Chrome's Web Speech recognition (name-asking, spoken
  Patronus) is server-side — bring a phone hotspot. Speech *synthesis*
  prefers a `localService` Czech voice (`speak()` in `voice-greeting.ts`),
  so it keeps working offline.
- **Public web version (GitHub Pages)**: `npm run build:web` →
  static export in `out/` (`scripts/build-web.mjs`), served from
  `/harry-potter-wand/`. `.github/workflows/pages.yml` runs it on every
  push to `main`. Driven by `NEXT_PUBLIC_WEB_BUILD`/`NEXT_PUBLIC_BASE_PATH`
  (`src/lib/web-build.ts`): no lamp, no photo saving, operator tools
  hidden on `/`. Route handlers can't be in a static export, so the script
  temporarily moves `src/app/api` out of `src/app` during the build. Any
  new raw asset URL (image/audio/model path, not a `<Link>`) must go
  through `asset()` or it 404s under the subpath.
- The dev server does **not** survive a Mac reboot/sleep-wake-with-restart — it has
  to be started manually every time after the machine restarts.
- Always run `npx tsc --noEmit` and `npm run lint` (`eslint`) after any change to
  the game pages before calling something done — both must be clean. Neither has a
  build step involved; Turbopack dev mode picks up file changes immediately.
- No test suite exists or is planned — this is a one-off event app, verification is
  type-checking + linting + manual/live testing with a real camera, hand, and voice.

## Route map

- `/` — home hub. Three activity tiles, extensible list (`ACTIVITIES` in
  `src/app/page.tsx`). Background image is optional and configurable, see
  "Home hub background" below.
- `/kouzla` — setup screen for "Základy kouzel" (spell basics): pick one of the
  images in `public/backgrounds/` and one of `public/patronus/` (click = select,
  yellow border = selected), then a button links to `/kouzla/hra?bg=<id>&patronus=<id>`.
- `/kouzla/hra` — the actual spell-casting game. See "kouzla/hra in detail" below.
- `/bubaci` — setup screen for "Zažeň bubáka" (banish the boggart): pick a boggart
  type (`spiders`, `dementor`, or `snake`), links to `/bubaci/hra?bubak=<id>`.
- `/bubaci/hra` — the boggart mini-game. See "bubaci/hra in detail" below.
- `/famfrpal` — setup screen for "Trénink famfrpálu" (Quidditch training).
  Picks one of 4 fixed round modes (duration x snitch speed — see
  "famfrpal/hra in detail" below for why speed needed to be pickable at
  all), same select-a-tile-then-confirm pattern as `/kouzla`/`/bubaci`, then
  a button links to `/famfrpal/hra?duration=<seconds>&speed=<fast|slow>`.
- `/famfrpal/hra` — catch-the-golden-snitch mini-game. See "famfrpal/hra in
  detail" below.
- Operator tools (small links at the bottom of `/`, `TOOLS` in `page.tsx`):
  - `/kontrola` — pre-flight checklist: internet, camera (label +
    resolution + live preview), actually loads all 3 models from local
    files, all images, music, photo storage, local Czech TTS voice; plus
    manual mic/speaker/lamp test buttons.
  - `/fotky` — slideshow of every saved photo (`GET /api/photos`), for the
    TV in the evening. Filter bubáci/patroni, ←/→, space = pause, click =
    fullscreen + music; re-fetches every 30s.
  - `/diplomy` — printable A4-landscape diploma per kouzla tutorial session
    (sessions with a `meta.json`): editable name, kluk/holka verb ending,
    photo picked from that session's Patronus shots, on-screen preview
    (same component, scaled 0.5), print one or all (`@media print` shows
    only `.diploma` sheets). Edits are page-local, never written back.

All three `*/hra` pages follow the same overall shape: a hidden `<video>`
element fed by `getUserMedia`, a full-screen `<canvas>` that's the only thing
actually visible, `click` anywhere to enter fullscreen, and a
`requestAnimationFrame` loop that reads the current video frame, runs ML
inference on it, and redraws the canvas every frame. All three are "use
client" pages with a single big `useEffect` that owns the camera stream + ML
model lifecycles.

## `kouzla/hra` in detail (`src/app/kouzla/hra/page.tsx`)

Loads two MediaPipe models: `HandLandmarker` (21 hand landmarks, tracks the index
fingertip for gesture + spell trail) and `ImageSegmenter` (`selfie_segmenter`,
real-time background replacement). Renders, per frame: chosen background image →
segmented person cut out and drawn on top (mirrored) → spell trail + fingertip dot
(mirrored, drawn with the person) → Patronus effect (screen-space, not mirrored) →
tutorial guide shape / Lumos glow (screen-space, not mirrored).

**Spells** — a swipe gesture (`GestureDetector` in `src/lib/gesture-detector.ts`,
classifies dominant-axis swipe direction with a speed threshold) maps to one of 2
spells via the `SPELLS` constant at the top of the file:
- right → Nox
- up → Wingardium Leviosa

**Lumos and Expelliarmus are deliberately not in `SPELLS`** — each has its own
dedicated `GestureDetector` instance, tuned stricter than the shared
`detectorRef` that handles right/up:
- **Lumos** — still a plain down-swipe, but `lumosDetectorRef` uses a much
  larger `minDistance` (0.3 vs. the default 0.18), so an incidental small
  downward hand movement (lowering the wand between casts, adjusting grip,
  etc.) doesn't cast it as easily as a real, deliberate swipe does.
- **Expelliarmus** — still a plain left-swipe, but `expelliarmusDetectorRef`
  uses a `minAverageSpeed` (normalized units/sec — `GestureDetector` now
  supports this as a third constructor param, gating on `distance /
  durationSec` in addition to the existing distance/cooldown checks) at the
  *default* `minDistance`, so it needs a genuinely fast, sharp swipe. Originally
  `2.2`, which turned out to be basically unlandable on the first live test
  ("nedaří se mi, je to asi moc rychlé") — dropped to `1.1` (still above
  `MOVE_SPEED_THRESHOLD` = 0.9, so not just "any swipe", but far more
  forgiving); confirmed working at `1.1` on the next live pass.

All three detectors (`detectorRef`, `lumosDetectorRef`,
`expelliarmusDetectorRef`) sample the same wand-tip position every frame;
each only looks at the one direction result it cares about (down / left)
except `detectorRef`, which dispatches right/up through `SPELLS`.

**Briefly renamed to Stupefy, then reverted — keep it Expelliarmus.** Once
the "shoots a bolt from the wand" visual effect below was built, Expelliarmus
(the disarming charm — knocks a wand out of someone's hand) stopped fitting
its own effect, so everything was renamed to Stupefy (the Stunning Spell,
lore-wise a much better match for "fires a jet of light"). The owner reverted
it on the very next message — "Stupefy" reads oddly said aloud in Czech,
which matters more here than lore accuracy, since the app speaks the spell
name via TTS and the effect is homemade anyway (not trying to be a lore
simulator). So: it's Expelliarmus again, lore mismatch and all, and probably
staying that way — don't re-propose the Stupefy rename without being asked.

**Expelliarmus fires a visual "shot"** — `SpellBoltEffect`
(`src/lib/spell-bolt-effect.ts`): a jagged green lightning bolt
(`EXPELLIARMUS_BOLT_COLOR`) that cracks into view from the wand tip's current
on-screen position and extends leftward across the screen (matching the
swipe direction), then fades — pure code-driven animation, no image/GIF
asset. This is the *second* design: the first version was a glowing orb that
traveled slowly across the screen with a trail behind it (reusing
`WandTrailEffect`'s "moving head + fading dots" recipe), which read as "shot
a ball," not "shot lightning" — real lightning cracks into view almost
instantly rather than flying like a thrown projectile, so the owner asked for
an actual bolt shape instead. The current version generates a zigzag path
*once* per cast (`SEGMENTS` points, alternating perpendicular offset via
`ZIGZAG_AMPLITUDE`, tapering to land exactly on the straight line at the tip)
and animates it in three phases against wall-clock time since `trigger()`:
`GROW_MS` (70ms, the path reveals almost instantly by revealing an increasing
prefix of its points — this *is* the "crack"), `HOLD_MS` (90ms at full
brightness, the flash itself), `FADE_MS` (220ms alpha fade-out). Drawn as a
colored glowing stroke (`shadowBlur`) with a thin bright white-hot stroke on
top for the core — still just two `stroke()` calls per frame, no
per-segment/per-particle overdraw. Triggered with
`boltEffectRef.current.trigger(origin, direction, length, color)` — `length`
in pixels (`canvas.width * 1.05`, so it visibly exits the screen regardless
of resolution) is passed in by the caller since the effect itself doesn't
know the canvas size. `origin` is computed as `{ x: canvas.width - px, y: py
}` — the *mirrored* on-screen position, since the bolt is drawn in
screen-space (after `ctx.restore()`, alongside Patronus) while `px`/`py` are
raw pre-mirror pixel coordinates. Fires on every real cast, tutorial or not,
same as the Lumos glow.

**Wingardium Leviosa's feather** — `FeatherEffect` (`src/lib/feather-effect.ts`):
a 🪶 emoji (code-driven animation, no asset) that hovers near the wand tip,
then "lets go" and floats up-then-down once triggered. Unlike Lumos/Nox/
Expelliarmus's visual signatures, this is **tutorial-only by design** — the
owner asked for it specifically as part of the guided Wingardium Leviosa step,
not as a free-play effect on every subsequent up-swipe. Four phases (`hidden`
→ `idle` → `rising` → `falling` → `done`):
- `show(x, y)` (called from `teachWingardium()`) puts it in `idle`, hovering
  `HOVER_OFFSET_Y` above the given point with a small sinusoidal bob.
- While idle, `updateIdlePosition(x, y)` is called every frame with the
  current wand tip (`loop()` calls this unconditionally alongside the trail
  update) — it's a no-op once no longer idle, so calling it doesn't need its
  own "are we in the right tutorial step" guard.
- `liftoff(now)` (called on any classified "up" swipe — safe to call
  unconditionally in free play too, since it's a no-op unless currently idle)
  switches to `rising`: moves up `RISE_DISTANCE` over `RISE_MS` with an
  ease-out curve (the magical lift — fast at first, slowing at the top).
- Then `falling` automatically: drifts back down `FALL_DISTANCE` over the much
  longer `FALL_MS`, with a sinusoidal side-to-side sway (`FALL_SWAY_AMPLITUDE`/
  `FALL_SWAY_CYCLES`) and a matching rotation wobble — real feathers don't
  drop, they drift — fading out (`FADE_START_FRACTION` of the way through)
  rather than needing a hard cutoff.
- `render()` no-ops in `hidden`/`done`. Drawn *inside* the mirror transform
  (unlike the Expelliarmus bolt), since while idle it needs to track the
  hand's on-screen position, same coordinate space as `WandTrailEffect`.
  Called unconditionally every frame in `loop()` (not gated on `hand` being
  detected that frame) so the rise/fall animation keeps playing smoothly even
  if hand tracking blips for a frame.

**A letter-gesture ("draw an L with the wand") was tried here and reverted —
don't redo it without solving the underlying live-testing gap first.** Two
implementations were built and both failed once actually tested with a real
hand, for different reasons each time: reusing `GestureDetector`'s swipe
classification (broke because its 900ms cooldown ate the L's fast second
stroke, and separately because a continuously-drawn L without a paused corner
never produced two distinct classified swipes at all), then a from-scratch
raw-trajectory detector modeled on `CircleGestureDetector`'s heading-tracking
approach (correct in spirit, but still felt "off"/unreliable enough live that
the owner asked to abandon it — simple direction swipes were confirmed to
work well, but shape/letter tracing did not, at least on the first attempt).
The core problem: this kind of gesture tuning fundamentally needs live
iteration with a real camera and a real hand, which wasn't available while
building it — two blind attempts weren't enough to get it right. If a
compound/shape gesture is wanted again, budget for live back-and-forth
testing rather than another single blind implementation pass.

**Guided tutorial** — triggered **only** by pressing **N** (deliberately manual,
not auto-started on page ready, so it can be fired at the exact moment a child
is in position — e.g. while the next kid in line is still getting settled). Now
teaches **five** spells in sequence, Lumos → Nox → Expelliarmus → Wingardium
Leviosa → Patronus, each step following the same pattern: speak an
instruction, *then* show a matching guide once the instruction has actually
finished (not while it's still being read — see below), wait for that spell's
own trigger to fire, praise, chain to the next.
1. `runIntroTutorial()` asks the child's name (`askForVocativeName`), greets them
   ("Ahoj, {vocative}!"), then speaks "Teď zkus své první kouzlo! Zkusíme
   rozsvítit lampu. Máchni hůlkou dolů a řekni: Lumos!", and once that finishes
   shows a hand-drawn (not emoji) pulsing gold downward arrow (shaft +
   triangular arrowhead) via `tutorialStepRef.current = "guide-lumos"`. The
   app does **not** listen for the spoken word "Lumos" — the gesture alone is
   the trigger.
2. Once the down-swipe lands on `lumosDetectorRef` (handled in `loop()`, not
   `runIntroTutorial()` — see above): hides the guide, starts the lumos glow,
   and via the shared `praiseThen()` helper, ~600ms later (so the glow
   visibly starts first) speaks **and displays** "Skvělé!", then chains into
   `teachNox()`: speaks "Nyní zkusíme světlo zhasnout. Řekni Nox a máchni
   hůlkou doprava.", then shows a plain rightward arrow guide
   (`tutorialStepRef.current = "guide-nox"`) until a right-swipe lands.
3. On the right-swipe during `"guide-nox"`: praises again, then chains into
   `teachExpelliarmus()`: speaks "Teď něco pořádného: Expelliarmus! Rychle
   mávni hůlkou doleva!", then shows a green leftward arrow guide (colored to
   match the bolt effect, pulsing faster than the other guides to hint
   "quickly") via `tutorialStepRef.current = "guide-expelliarmus"`, until a
   fast left-swipe lands on `expelliarmusDetectorRef`.
4. On that fast left-swipe: praises again, then chains into
   `teachWingardium()`: speaks "A teď to nejkouzelnější: Wingardium Leviosa!
   Zvedni pírko mávnutím nahoru.", then makes the feather appear
   (`featherEffectRef.current.show(x, y)`, at the current wand-tip position —
   read from `lastHandTipRef`, since this runs from an async function outside
   `loop()`'s per-frame closure) via `tutorialStepRef.current =
   "guide-wingardium"`, until an up-swipe lands.
5. On that up-swipe: praises again, then chains into `teachPatronus()`:
   speaks "Poslední a nejsilnější kouzlo: vyčaruj svého Patrona! Řekni
   Expecto Patronum, nebo jen slovo patron, a mávni hůlkou." No arrow/shape
   guide for this one — casting is **voice-only** (same as free play; the
   owner explicitly said the wand motion doesn't matter here), so there's
   nothing directional to draw, and nothing to delay either —
   `tutorialStepRef.current = "guide-patronus"` is set right after speaking
   (see "Patronus voice recognition" below for what it's actually listening
   for).
6. Once Patronus actually triggers (either "Expecto Patronum" or "patron" —
   both funnel through the same `patronusListener` → `triggerPatronus()`, see
   below): `triggerPatronus()` itself — not a chained tutorial-step function —
   checks `tutorialStepRef.current === "guide-patronus"` and, if so, sets it
   to `"done"` and calls `celebrateTutorialComplete()`: a **longer
   congratulation** instead of the usual "Skvělé!" ("Skvěle! Zvládl jsi svá
   první kouzla — jsi opravdový kouzelník!"), delayed 1200ms (vs.
   `praiseThen()`'s 600ms, giving the Patronus effect's own 600ms fade-in
   room to land first) and shown via `greetingText` (the instruction banner,
   sized for full sentences) rather than `spellText` (short exclamations).

**Copy pass — punchier, but not uniformly.** The Expelliarmus/Wingardium/
Patronus/finale lines above were tightened from longer originals (cut hedging
words like "zkusíme"/"prostě", lead with the verb, drop exposition that
spoils the moment) after the owner asked for shorter, more "sold" lines to
hold kids' attention. **Lumos and Nox were deliberately left as their longer,
more explicit originals** ("Zkusíme rozsvítit lampu...", "Nyní zkusíme světlo
zhasnout...") — the real HomeKit lamp (see "HomeKit lamp integration" below)
can have a noticeable real-world delay after the spell registers, so those two
specifically need the kid to already understand "the lamp is what's about to
happen" *before* they cast, or a laggy lamp response reads as "did that not
work?" instead of "wait for it." If tightening these two ever comes up again,
that's the reason not to — it's not an inconsistency, it's deliberate.

**Guides/feather reveal only after the instruction finishes speaking, not
while it's being read** — `tutorialStepRef.current` (and, for Wingardium,
`featherEffectRef.current.show()`) moved to *after* `await speak(instruction)`
in every step above, with a `cancelled` check in between. The first version
set it *before* `speak()`, so the arrow/feather appeared immediately while
the instruction was still being read aloud — the owner asked for the reveal
to wait until the sentence is actually finished, so a kid isn't looking at
the guide before they've heard what it means.

This praise is tutorial-only — it does not repeat on every subsequent
free-play cast of any of these five, only each spell's own visual signature
(Lumos glow, lamp toggle, Expelliarmus bolt) does — except the feather, which
is deliberately **tutorial-only entirely**, not a free-play visual at all (see
below).

**Patronus voice recognition matches the word "patron", not the specific
animal name — and this went through two revisions worth knowing about.**
1. First version: give "Expecto Patronum" a timed head start
   (`PATRONUS_PHRASE_TIMEOUT_MS`), then — if nothing landed — pause the phrase
   listener and switch to a *separate* one-shot `cs-CZ` recognition loop
   listening specifically for this session's patron animal name (from
   `PATRONUS_CATALOG`). Replaced because the owner wanted both live
   immediately, not one after a timed fallback.
2. Second version: both checked "immediately" by adding the animal name as an
   `extraWords` match on the *same* always-on listener (see below) — no
   second recognition session needed, since only one `SpeechRecognition`
   session can be active at a time anyway. This surfaced a real problem
   though: "liška" specifically turned out to be unreliable for the
   recognizer.
3. **Current version**: instead of the session-specific animal name,
   `extraWords` is just the fixed word `"patron"` — easier to say and
   recognize than any specific animal name, and doesn't need
   `PATRONUS_CATALOG`/`patronusId` lookup in `kouzla/hra` at all anymore (that
   import was removed from this file; `PATRONUS_CATALOG` is still used by
   `/kouzla` for the setup-page tile labels). "Expecto Patronum" is
   unchanged. `startPatronusListener()` (`src/lib/voice-recognition.ts`)
   still takes the same `extraWords: string[]` param from the previous
   revision (kept generic — the mechanism doesn't care what's in the array),
   and on every transcript checks `matchesPatronusPhrase(transcript) ||
   extraWords.some(word => normalize(transcript).includes(normalize(word)))`.
   `kouzla/hra` now calls it with `["patron"]`. `teachPatronus()` mentions
   "patron" explicitly in the spoken instruction so it's not a hidden trigger.

Patronus, Patronus voice recognition, background music, and the resource-cleanup
pattern are documented in their own sections below since they're shared concerns
across both `*/hra` pages (well, Patronus is `kouzla/hra`-only, but the resource
pattern isn't).

## `bubaci/hra` in detail (`src/app/bubaci/hra/page.tsx`)

Three boggart variants share this one page, picked via the `?bubak=` query
param (`spiders` default, `dementor`, or `snake`). `HandLandmarker` is always
loaded (wand-tip trail + circle-gesture banish are shared by all three); which
*second* model loads depends on the variant — the original "no segmenter, too
heavy" perf reasoning is preserved per-mode rather than overridden, so every
mode stays a 2-model page:
- **`spiders`** — `FaceLandmarker` (468 face landmarks), no `ImageSegmenter`, just
  the mirrored raw camera feed (no background swap).
- **`dementor`** — `ImageSegmenter` (`selfie_segmenter`), no `FaceLandmarker`.
- **`snake`** — also `FaceLandmarker` (added after the owner noticed the strike
  always aimed at a fixed screen point regardless of where he'd moved — see
  below), no `ImageSegmenter`. Same model load as `spiders`, just used
  differently (one landmark for aim, not six for crawling). **Also loads
  `ImageSegmenter` now, but photo-only** — it never runs per frame, only
  inside `captureSnakePortrait()` a few times per strike (see "Boggart
  reaction photos" below), so the per-frame cost is still 2 models.

On ready, `runIntro()` fires **automatically** (unlike `kouzla/hra`'s now-manual N
trigger — this asymmetry hasn't been revisited; if the manual-trigger preference
turns out to apply here too, mirror the same pattern). It asks the child's name via
`askForVocativeName`, then speaks a personalized instruction that differs only in
the creature noun (all three are grammatically still just "a boggart" in-universe,
so `dementor` deliberately says "bubák/bubáky", not "mozkomor"):
- spiders: "{Name}, musíš zahnat pavouky! Mávni hůlkou do kruhu a odeženeš pavouka."
- dementor: "{Name}, musíš zahnat bubáky! Mávni hůlkou do kruhu a odeženeš bubáka."
- snake: "{Name}, musíš zahnat hady! Mávni hůlkou do kruhu a odeženeš hada."

Deliberately **not** a spoken "Riddikulus" trigger for either — too hard for kids to
pronounce reliably, so a wand gesture (circle) is the trigger instead, reusing the
name-ask flow that already existed.

**Wand-tip tracking**: both variants draw the trail/dot at `estimateWandTip(hand)`,
not the raw `hand[8]` (index fingertip) landmark — kids hold a real wand/prop that
extends past their fingertip, so the tip is extrapolated along the
wrist(`hand[0]`)→fingertip(`hand[8]`) direction by `WAND_TIP_EXTENSION` (currently
`0.7`, a fraction of that vector's own length — tune this one constant if it looks
too close/far from the real wand tip once tested live). Wrist→fingertip is used
(not just the last finger segment) because it's a longer, steadier baseline, so
ordinary hand-tracking jitter isn't amplified as much by the extrapolation.

**Spiders**: `SpiderEffect` (`src/lib/spider-effect.ts`) renders a crawling 🕷️ emoji
between 6 curated "safe" face landmark indices
(`FACE_ANCHOR_INDICES = [10, 1, 152, 234, 454, 9]` — forehead, nose tip, chin,
left/right face edge, between eyebrows; deliberately avoids eyes/mouth). A fresh
`new SpiderEffect()` is created on every respawn (cheap — no asset loading).

**Dementor**: `DementorEffect` (`src/lib/dementor-effect.ts`) draws a cutout image
(see `image-cutout.ts` below) positioned to loom *behind the child* — the one
place this variant genuinely needs the segmenter, since "behind the person" means
real depth compositing, not just a screen-space overlay. Per frame: draw the raw
video (mirrored, same as always) → compute the segmentation mask →
`computeMaskBounds()` (`background-composite.ts`) finds the on-screen bounding box
of "person" pixels → `DementorEffect.render()` draws the shape sized ~1.55x taller
than that bbox, vertically anchored so it extends above the head and below the
feet → the person cutout (`applyMaskAlpha`, same technique `kouzla/hra` uses) is
drawn on top last, occluding whatever part of the dementor overlaps the body. All
of this happens inside the *same* mirror transform as everything else in this page
(unlike `kouzla/hra`, there's no separate unmirrored background layer — the "world"
here is the live feed itself, so raw-video-draw → dementor-draw → person-cutout-draw
all happen in one `ctx.save()/scale(-1,1)/restore()` block, in that order). Falls
back to a centered `FALLBACK_BOUNDS` region if nobody's in frame yet.
Respawning reuses the same `DementorEffect` instance via `spawn()` (resets
banish/done state) rather than `new`-ing a fresh one like `SpiderEffect` does —
recreating it would mean re-loading and re-cutting-out the image every
`RESPAWN_DELAY_MS` (700ms) cycle. The image itself is optional at the
code level: `DementorEffect` tolerates a not-yet-loaded/missing cutout (renders
nothing, but the banish/respawn state machine still advances normally) — see
"Assets" below for the expected file.

**Snake**: `SnakeEffect` (`src/lib/snake-effect.ts`) went through two design
iterations, both worth knowing about if this ever gets revisited:
1. A plain 🐍 emoji that just grew and moved toward the viewer — read as
   "sliding/zooming," not "wants to bite you."
2. A **hand-drawn** head (canvas paths, same idea as `kouzla/hra`'s tutorial
   arrow) with a hinged jaw that pivoted open during the lunge — technically
   did what was asked (the mouth genuinely opened, aimed via `Math.atan2()`
   at the strike target), but simple flat-color vector shapes read as
   cartoonish/comical, not menacing, once actually seen live.

**Current version** uses a real source image instead (like `DementorEffect`/
`PatronusEffect`: `loadShape(url)` → `cutoutImageByLuminance()` from
`image-cutout.ts`), showing the snake *already* mid-strike with its mouth
open — there's no separate closed-mouth pose to animate from, so the "jaws
opening" beat is gone entirely in favor of a harder cut: **invisible while
idle**, `render()` returns immediately without drawing anything, so there's
zero telegraphing — then it snaps into view already fully open and flies at
the viewer. A small state machine (`idle` → `lunging` → `holding` →
`retreating` → back to `idle`) cycles continuously while active: waits
`STRIKE_DELAY_MS` (randomized 1-2s per cycle, the "waits a second or two,
then jumps at you" the owner asked for) invisible, then appears at a
screen-space corner (`COIL_POSITIONS`) and grows/moves toward a **target**
over `LUNGE_MS` (200ms, `t*t` eased for a sudden snap), sizing up from
`START_WIDTH_FRACTION` to `PEAK_WIDTH_FRACTION` of canvas width. Holds
briefly at full size (the "bite" freeze-frame, extended to `HOLD_MS = 900`
after the first live test — the original 160ms flashed by too fast to
register), retreats back toward the coil point while shrinking, then goes
invisible again and repeats — so if a child doesn't banish it quickly it
strikes again rather than sitting there once. `banish()` short-circuits to
`done` immediately if called while idle/invisible (nothing to fade out),
otherwise plays the normal shrink+fade. Like `DementorEffect`, `spawn()`
resets an existing instance rather than `new`-ing a fresh one, and tolerates
a not-yet-loaded/missing image (state machine still runs, just nothing
draws) — see "Assets" below for the expected file.

**The target isn't fixed** — `render()` takes a `faceTarget` param
(`page.tsx` passes the current frame's face landmark 1 / nose tip from
`FaceLandmarker`, or `null` if nobody's detected) and locks it into
`this.target` at the exact moment a strike begins (`idle` → `lunging`), not
re-tracked every frame during the lunge itself — re-aiming mid-flight would
look like the snake curving through the air rather than striking. This is
why the `snake` variant needed `FaceLandmarker` added after all (see above):
the very first version aimed at a fixed `FALLBACK_TARGET` (screen center),
and the owner immediately noticed it kept striking the same spot even after
he'd moved. `FALLBACK_TARGET` is still used whenever no face is detected at
the moment a strike begins.

All three variants share the same circle-gesture-triggered banish flow and the
same `RESPAWN_DELAY_MS = 700` cooldown. `CircleGestureDetector`
(`src/lib/circle-gesture-detector.ts`) detects a circle drawn with the wand tip →
`.banish()` (shrink+fade) on whichever effect is currently active.

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

## `famfrpal/hra` in detail (`src/app/famfrpal/hra/page.tsx`)

The newest and by far the simplest of the three `*/hra` pages — a
catch-the-golden-snitch mini-game, added as a lightweight third activity
alongside the spell tutorial and the boggart games (the owner has a *real*
physical Sorting Hat for the event, so that idea stayed out of the app; house
points also got skipped — the campers are preschool-age, unlikely to track a
running score across activities). Loads only `HandLandmarker` — no face, no
segmentation, no boggart-style variant branching — making it the lightest
page in the app.

**Duration and speed are both configurable from `/famfrpal`**, read via
`useSearchParams()` (same pattern `kouzla/hra`/`bubaci/hra` already use for
`bg`/`patronus`/`bubak`) — `?duration=<seconds>` (default `60`, via
`DEFAULT_ROUND_DURATION_S`) and `?speed=fast|slow` (default `fast`). Added
after the owner pointed out the group spans a wider age range than the
minute-long/full-speed original design assumed: older kids handled it fine,
but younger ones need both a shorter round and a slower snitch. `speed`
doesn't gate a separate code path — `speedMultiplier` (1 for fast,
`SLOW_SPEED_MULTIPLIER = 0.45` for slow) is passed straight into
`GoldenSnitchEffect.setSpeedMultiplier()`, which just scales its existing
`SPEED_FRACTION_PER_SEC` in `update()`. `roundDurationMs` (derived from
`duration`) replaces what used to be a fixed `ROUND_DURATION_MS` constant
everywhere it's used. Both values are stable for the page's lifetime (set
once from the URL at mount, no in-page way to change them mid-round), so
closing over them from the big `useEffect` is safe — they're just listed in
its dependency array like `backgroundBasePath`/`patronusBasePath` are in
`kouzla/hra`.

**Flow**: on ready, `startRound()` fires automatically (no manual trigger,
no name-asking — this is meant to be a quick, repeatable activity for a line
of kids, not a one-on-one tutorial): speaks "Trénink famfrpálu! Chyť co
nejvíc zlatonek, než vyprší čas!" (deliberately duration-agnostic wording,
since the round can now be 30s or 60s), then a 3-2-1-"Chyť je!" on-screen
countdown (`COUNTDOWN_STEPS`, `COUNTDOWN_STEP_MS` = 700ms per step, shown via
`countdownText` — pure ceremony/drama, doesn't gate anything). Once that
finishes: spawns the snitch, sets `roundEndAtRef.current = now +
roundDurationMs`, and starts a `setInterval` (250ms) that just recomputes
`timeLeftSeconds` for display — the actual round-active check elsewhere is
`now < roundEndAtRef.current`, not this interval, so display lag/pausing
doesn't affect gameplay timing.

**Catch mechanic**: every frame, if a hand is tracked, landmark 9 (middle
finger MCP — a stabler "center of the hand" point than the fingertip, which
this game doesn't need to track precisely the way the wand-casting games do)
is compared against `GoldenSnitchEffect.getPosition()`; within
`CATCH_RADIUS_FRACTION` (0.07, i.e. 7% of canvas width — was 0.09, shrunk
once per live feedback that the ring/tolerance felt too generous — still
deliberately forgiving, this is built for small kids, not precision) of
canvas width, it's
a catch: `playSpellSound("catch")`, `scoreRef.current` increments (mirrored
into `score` state for display — same ref-for-logic/state-for-display split
used throughout this app, since the per-frame `loop()` closure would
otherwise read a stale `score`), and `GoldenSnitchEffect.deactivate()` hides
it (no draw, no update) rather than respawning it immediately —
`respawnAtRef.current = now + RESPAWN_DELAY_MS` (900ms) is checked once per
frame at the top of the `roundActive` block in `loop()`, and only then calls
`spawn()` to place the next one. This deliberate gap replaced an earlier
instant-respawn (teleport-on-catch, no pause at all) per live feedback that a
short breather after each catch reads better than one appearing again
immediately. `CATCH_COOLDOWN_MS` (400ms) still guards against the same catch
registering across consecutive frames before `deactivate()` takes effect,
though `isActive()` being false during the respawn gap now also prevents
re-catching mid-pause on its own. A soft
glowing ring is drawn at the catch point on every frame a hand is tracked
(not just mid-round) — pure visual aid so kids can see exactly where they
need to be, cheap (one more `shadowBlur` circle, same budget-conscious
approach as everything else in this app).

**Round end** is detected *inside* `loop()` (not the display `setInterval`,
which only reads a value — never writes game state) via a
`roundEndHandledRef` guard so it fires exactly once: plays
`playSpellSound("fanfare")` and shows `` `Trénink dokončen! Chytil jsi
${scoreRef.current} zlatonek! 🏆` ``. No in-page restart — same convention as
the other two games: the owner navigates back to `/famfrpal` and clicks
"Začít trénink" again for the next kid, which remounts the page and gets a
completely fresh round.

Everything (video, snitch, catch ring) is mirrored together in one transform,
same simplification `bubaci/hra` uses (no separate background layer to keep
unmirrored) — and since catch-detection compares the snitch's position
against the hand's position, both computed in that same raw pre-mirror pixel
space, the comparison is correct regardless of the mirror (mirroring only
affects where things are *drawn*, not the coordinates used for game logic —
this is the same reasoning `bubaci/hra`'s circle-gesture detection already
relies on, as opposed to `kouzla/hra`'s left/right swipe classification,
which *does* need a mirror-aware fix — see "Mirroring" below for why those
two cases are different).

## Shared library code (`src/lib/`)

- **`gesture-detector.ts`** — `GestureDetector`, 4-direction swipe classifier
  (speed-threshold start/stop, dominant-axis + sign at the end). `kouzla/hra`-only
  (`bubaci/hra` doesn't need spell direction, so it only uses `WandTrailEffect`
  + `CircleGestureDetector`, not this) — dispatches right/up to `SPELLS`.
  Constructor takes optional `cooldownMs` (default 900ms), `minDistance`
  (default 0.18, normalized units), and `minAverageSpeed` (default 0, i.e. no
  minimum — normalized units/sec, checked as `distance / durationSec`) params.
  `kouzla/hra` runs **three separate instances**: `detectorRef` at the
  defaults for right/up, `lumosDetectorRef` at `minDistance = 0.3` so Lumos
  needs a bigger down-swipe, and `expelliarmusDetectorRef` at
  `minAverageSpeed = 1.1` so Expelliarmus needs a genuinely fast left-swipe (down
  from an initial `2.2` that proved basically unlandable live) — see
  "kouzla/hra in detail" above for why each exists (an unqualified down-swipe
  was too easy to trigger by accident; a slow left-swipe didn't feel like a
  "shot") and for the letter-gesture experiment that was tried and reverted
  before landing on the Lumos fix.
- **`circle-gesture-detector.ts`** — `CircleGestureDetector`, heading-based circle
  detector, see above. `bubaci/hra`-only.
- **`spell-bolt-effect.ts`** — `SpellBoltEffect`, see "kouzla/hra in detail"
  above (the Expelliarmus bolt, incl. the first "traveling orb + trail"
  design that got replaced). No asset — a zigzag path generated once per
  cast and revealed/faded over time. `kouzla/hra`-only, though generic enough
  (takes origin/direction/length/color) to reuse for another spell's "shot"
  later.
- **`feather-effect.ts`** — `FeatherEffect`, see "kouzla/hra in detail" above
  (the Wingardium Leviosa feather). No asset — a 🪶 emoji, same "renders
  crisply at any size via `ctx.font`" reasoning as `SpiderEffect`/`SnakeEffect`.
  `kouzla/hra`-only, and unlike every other effect in this app, deliberately
  **tutorial-only** rather than a recurring free-play visual.
- **`wand-trail.ts`** — `WandTrailEffect`, the shared wand-tip trail visual for
  both game pages (constructed with a per-page `trailLifetimeMs`: 500 for
  `kouzla/hra`, 800 for `bubaci/hra`). `addPoint(x, y, t)` records a pixel-space
  point each frame; `render(ctx, now)` draws three layers, cheapest-first: a thin
  fading connective line between points (low alpha, tapers with age — deliberately
  subtle, a full-opacity line here read as too blocky), fading comet-tail dots
  (shrink/fade with age), and 1-2 short-lived "spark" particles spawned per point
  (plain filled circles, warm gold/white palette, ~300ms life, position derived
  from birth time so there's no per-frame integration drift) — plus a single
  glowing tip dot (`shadowBlur`) shown only while a point was added within the
  last frame. Deliberately avoids per-particle gradients/shadowBlur (same lesson
  as `patronus-effect.ts` below) — the only `shadowBlur` call is that one tip dot,
  regardless of how many trail points/sparks exist.
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
  visualization entirely). (Wand-tip *tracking*, as opposed to visibility, was
  solved separately and safely for `bubaci/hra` — see `estimateWandTip` above; no
  masking involved there since that page always draws the full raw feed.) Also
  exports `computeMaskBounds()` — scans a confidence mask (at the mask's own, much
  lower resolution, not the full video frame) for the normalized bounding box of
  "person" pixels above a threshold; used by `dementor-effect.ts` to position the
  dementor relative to wherever the child is actually standing, with no face/hand
  landmarks needed for that.
- **`image-cutout.ts`** — `cutoutImageByLuminance()` and `loadImage()`, extracted
  from `patronus-effect.ts` and now shared with `dementor-effect.ts` and
  `snake-effect.ts`. Cuts the background out of a plain photo/painted-glow image
  using luminance-as-alpha, auto-detecting whether the subject is the light or
  dark pixels (whichever covers less of the frame) — works with zero manual
  masking as long as the source image has a reasonably clean, plain background.
  **First checks the four corner pixels' existing alpha** and skips the
  luminance rewrite entirely if they're already transparent (avg < 20) — added
  after `had.png` (the snake image) turned out to already be a proper
  pre-cut/transparent PNG, not a flat photo; overwriting its clean edges with a
  luminance guess would only have made them worse. So: a flat photo (no
  transparency) gets the luminance treatment as before, a pre-cut PNG is
  trusted and passed through untouched.
- **`patronus-effect.ts`** — `PatronusEffect`. `loadShape(url)` uses
  `cutoutImageByLuminance()` (see above) to cut the background out of a supplied
  glow-deer image, so any reasonably clean image on a plain background works with
  zero manual masking. `trigger()` starts a fade-in (600ms) → hold (2200ms) →
  fade-out (1400ms) sequence with a soft pulsing glow (`shadowBlur`, not
  per-particle gradients — an earlier particle-based version caused visible frame
  stutter). Uses plain alpha blending, not `"lighter"`/additive — additive got
  washed out against the bright Hogwarts sunset background.
- **`spider-effect.ts`** — `SpiderEffect`, see "bubaci/hra in detail" above.
- **`dementor-effect.ts`** — `DementorEffect`, see "bubaci/hra in detail" above.
  `loadShape(url)` reuses `cutoutImageByLuminance()`; unlike `SpiderEffect`,
  `spawn()` resets banish/done state on the *same* instance instead of
  constructing a new one, since the loaded/cut-out image is expensive to redo
  every respawn cycle.
- **`snake-effect.ts`** — `SnakeEffect`, see "bubaci/hra in detail" above (incl.
  the two earlier design iterations that got replaced, and why it ended up
  needing `FaceLandmarker` after all to aim its strike). `loadShape(url)`
  reuses `cutoutImageByLuminance()`, same as `DementorEffect`.
- **`golden-snitch-effect.ts`** — `GoldenSnitchEffect`, see "famfrpal/hra in
  detail" above. `loadShape(url)` reuses `cutoutImageByLuminance()`, same as
  `DementorEffect`/`SnakeEffect`; until that resolves (or if the asset is
  never supplied), `render()` falls back to a code-driven placeholder — a
  glowing orb (`shadowBlur`) with two flapping wing ellipses, all canvas
  paths, no asset needed for that fallback shape. Unlike the boggart effects,
  this one isn't face/person-anchored at all: `spawn(canvasWidth, canvasHeight, now)` picks a
  random point, then `update()` steers it toward a periodically-re-picked
  random target (`RETARGET_MS`) at a constant speed (`SPEED_FRACTION_PER_SEC`,
  a fraction of canvas width per second) — a simple "wander" behavior that
  reads as erratic/unpredictable without needing a fancier steering model.
  `getPosition()` exposes the current point for `famfrpal/hra`'s catch-check;
  `isActive()` gates whether it should be updated/rendered/tested at all
  (`famfrpal/hra` only calls `spawn()` once a round actually starts, so it's
  invisible the rest of the time). `deactivate()` hides it without picking a
  new position — `famfrpal/hra` calls this on a catch instead of an
  immediate `spawn()`, to leave the `RESPAWN_DELAY_MS` gap described above.
  `setSpeedMultiplier(multiplier)` scales `SPEED_FRACTION_PER_SEC` in
  `update()` — `famfrpal/hra`'s "pomalá" modes pass `0.45`
  (`SLOW_SPEED_MULTIPLIER`), "rychlá" leaves it at the default `1`; see
  "famfrpal/hra in detail" above for why speed needed to be configurable at
  all. `famfrpal/hra`-only, but nothing about the class is specific to that
  page if a future activity wanted a wandering object with the same "steer
  toward periodic random targets" behavior.
- **`spell-sounds.ts`** — `playSpellSound(id)`, all sounds are synthesized with the
  Web Audio API (oscillator sweeps + short "sparkle" note sequences) — no audio
  files. `SpellId` = `"lumos" | "nox" | "wingardium" | "expelliarmus" | "patronus" |
  "banish" | "catch" | "fanfare"` — the last two are `famfrpal/hra`'s catch chime
  and round-end fanfare; `SpellId` is really "any short synthesized game sound"
  at this point, not literally just spells (`"banish"` already wasn't a spell
  either — same precedent).
- **`voice-recognition.ts`** — `normalize()` (lowercase, strip diacritics via NFD +
  combining-mark regex, strip non a-z), `matchesPatronusPhrase()`, and
  `startPatronusListener(onDetected, extraWords?)`. The Patronus listener runs
  **continuous** English (`"en-US"`) recognition (fuzzy-matches
  "expect...patron/patrn" so accented pronunciation still hits) with
  auto-restart on `onend` unless explicitly stopped/paused. `extraWords`
  (optional string array, generic — this module doesn't care what's in it)
  also triggers `onDetected()` if `normalize()`d and found as a substring of
  the transcript — `kouzla/hra` currently passes `["patron"]` (see "Patronus
  voice recognition" in "kouzla/hra in detail" above for why that's a fixed
  word now, not a per-session animal name), so the same listener recognizes
  it right alongside "Expecto Patronum", no second recognition session
  needed. Exposes `setPaused()` because the browser's Web Speech API only
  supports one active `SpeechRecognition` session at a time, and the
  name-greeting flow needs the mic too — every voice-input flow that runs
  one-off recognition pauses this listener first and resumes it in a
  `finally`.
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
- **`patronus-catalog.ts`** — `PATRONUS_CATALOG`: the `{id, label}` list of
  patron animals (Jelen/Fénix/Liška/Kůň), used by `/kouzla` for the setup-page
  tile labels. Originally also imported by `kouzla/hra` for the Patronus
  tutorial's voice fallback, but that now listens for the fixed word "patron"
  instead of the session's specific animal name (see "kouzla/hra in detail"
  above), so that import was removed — this file is `/kouzla`-only again.
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
*everything* including the spider/dementor/snake, since there's no separate
background layer to keep unmirrored there — a deliberate simplification, not an
oversight. The snake's screen-space coordinates don't need to "mean" anything in
real-world terms, so mirroring it is arbitrary but harmless — it's drawn inside
the same transform purely for one consistent code path. The `dementor` variant
does composite a person-cutout layer like `kouzla/hra`, but because the
"background" there is the live feed itself rather than a distinct static image,
the raw-video-draw → dementor-draw → person-cutout-draw sequence all still
happens inside that one shared mirror transform, not split unmirrored vs.
mirrored like `kouzla/hra`.)

**Gesture classification needs the mirrored coordinate, not the raw one —
this bit `kouzla/hra`'s left/right spells for real.** `HandLandmarker` runs on
the unmirrored `video` element, so a landmark's raw `x` is in the *original*
(pre-mirror) coordinate space — but everything the player actually sees is
drawn through the mirror transform. Since only the horizontal axis is
mirrored, up/down classification is unaffected, but left/right is backwards:
a physical rightward swipe (matching the mirrored display, and matching an
on-screen "swipe right" arrow) produces a *decreasing* raw x, which
`GestureDetector` reads as `dx < 0` → "left". This sat unnoticed since no
spell's expected swipe direction was ever explicitly called out on screen
until the Nox tutorial step was added — that's what surfaced it ("nox je
jiným směrem, než se říká a ukazuje šipka"). Fixed in `kouzla/hra`'s `loop()`
by feeding both `GestureDetector` instances `1 - tip.x` (`mirroredX`) instead
of raw `tip.x`; `tip.y` is used as-is since vertical isn't mirrored. The trail
dot itself never had this problem — it's drawn *through* the mirror
transform, same as the person layer, so it was always visually correct;
only the classification math was reading the wrong coordinate space. Any
future gesture logic in either `*/hra` page needs to make the same choice
deliberately: raw coordinates for anything rotation/mirror-agnostic (like
`CircleGestureDetector`'s total-turn check, which doesn't care about
handedness), mirrored coordinates for anything with an on-screen or
spoken-language left/right meaning.

## Autoplay / audio

Browsers block audio (background music, and to a lesser extent
speech-synthesis-adjacent flows) from starting without a real user gesture. Both
music start and fullscreen are tied to the same `onClick` handler on `<main>` as a
guaranteed fallback, plus a best-effort automatic attempt once `status === "ready"`
that silently no-ops if the browser blocks it.

## HomeKit lamp integration (`kouzla/hra` only)

Lumos/Nox also toggle a real physical lamp plugged into a HomeKit-paired smart
plug — the one deliberate exception to "no backend": `src/app/api/lamp/route.ts`
is a Next.js Route Handler (still just this one Mac, no external server) that
runs a macOS Shortcut by name via `child_process.spawn`. `triggerSpell()` in
`kouzla/hra/page.tsx` fire-and-forgets a `POST /api/lamp` with
`{ state: "on" | "off" }` whenever `spell.id` is `"lumos"`/`"nox"` — errors are
caught and only `console.warn`'d, since a missing/unpaired plug must never break
the game. `bubaci/hra` isn't wired to this at all.

**The shortcut names are a fixed contract, not configurable from the UI**: two
macOS Shortcuts must exist, named exactly `LumosOn` and `LumosOff` (each just a
single "Control Home" action targeting the smart plug, with its state baked in
by clicking the accessory chip *inside* the action — there's no separate
"Turn On" action to search for). `SHORTCUT_BY_STATE` in `route.ts` maps state to
name; if the shortcut names ever change, that's the one place to update.

**The bug that ate most of the build time on this feature**: `shortcuts run
<name>` hangs *indefinitely* — no error, no output, no system dialog — when its
stdout/stderr are Node's default anonymous pipes. This is why the route uses
`spawn(..., { stdio: ["ignore", fd, fd] })` with `fd` a real file descriptor
(`fs.openSync` on a temp file) instead of `execFile` (which pipes by default) or
plain `spawn` with pipe stdio. Confirmed empirically while building this:
`execFile` and `spawn` with pipe stdio both hung every time regardless of
timeout; `spawn` with a real fd (or `stdio: "inherit"`) consistently exited in
under a second. If this ever needs touching again, **do not** switch back to
`execFile` or otherwise let stdio default to a pipe — it will silently
reintroduce the hang. A `SHORTCUT_TIMEOUT_MS = 5000` kill-the-child timer stays
in place regardless, as a last-resort safety net.

The physical device is a CozyLife-brand HomeKit smart plug (see memory —
`homekit-lamp-integration` — for the exact model/cottage-relocation context,
which isn't code-relevant but is useful background if this comes up again).

## Assets (`public/`)

- `backgrounds/1.*` (Bradavice), `backgrounds/2.*` (Bradavický expres),
  `backgrounds/3.*` (Bradavice - hala) — all three are real photos now, matched
  to the `BACKGROUNDS` array in `src/app/kouzla/page.tsx` (id = filename without
  extension). That setup-page section is `grid-cols-3` (one row) since there are
  exactly 3 — if a 4th is ever added, bump that to `grid-cols-4` or it'll wrap.
- `patronus/1.*` (Jelen), `patronus/2.*` (Fénix), `patronus/fox.*` (Liška),
  `patronus/horse.*` (Kůň) — glow-animal source images for the Patronus effect,
  matched to `PATRONUSES` in `kouzla/page.tsx` (note: ids aren't all numeric —
  `resolveImageUrl` just needs *some* basename, so `fox`/`horse` work exactly
  like `1`/`2` do). That section is `grid-cols-4` (one row) — the owner said no
  more than 4 total, so this doesn't need to stay generic/scalable.
- `music/background.mp3` — 315s track, shared by both `*/hra` pages, each
  looping a *different* stretch of the same file at a different volume — the
  file itself is never trimmed/re-exported, both loop points are purely
  in-app (`onTimeUpdate` resetting `currentTime`):
  - `kouzla/hra` — first `MUSIC_LOOP_END_SECONDS` (2:20 = 140s), i.e. `0:00`
    onward, at volume `0.35` (calmer, this is the gentle spell-practice game).
  - `bubaci/hra` — `BUBACI_MUSIC_START_SECONDS`-`BUBACI_MUSIC_END_SECONDS`
    (2:30-3:40), at volume `BUBACI_MUSIC_VOLUME = 0.5` (still louder/more
    tense than `kouzla/hra`'s 0.35 — the owner explicitly wanted this one
    dramatic, it's the scary-boggart game — but dialed down from an initial
    `0.65` after a live check came back "trochu slaběji", then again to
    `0.4` after the next live check still found `0.5` too loud). Needs an extra
    `onLoadedMetadata` handler (`kouzla/hra` doesn't) to seek to
    `BUBACI_MUSIC_START_SECONDS` once, since this loop doesn't start at
    `0:00` like the other one does.
- `menu/background.*` — optional, see "Home hub background" above. Doesn't exist by
  default.
- `bubaci/mozkomor.jpg` — dementor source image for `bubaci/hra`'s `dementor`
  variant, resolved via `resolveImageUrl("/bubaci/mozkomor")`, cut out via
  luminance-as-alpha (see `image-cutout.ts`). Supplied now — a dark robed figure
  on a plain white background, about as clean a case as the luminance-cutout
  technique gets (high-contrast, unambiguous which side is the subject).
  `DementorEffect` still tolerates a missing/failed-to-load image regardless
  (renders nothing, banish/respawn state machine still runs) — see
  `dementor-effect.ts`'s notes above for why that matters.
- `bubaci/had.png` — snake source image for `bubaci/hra`'s `snake` variant,
  resolved via `resolveImageUrl("/bubaci/had")`. Supplied now — a cobra,
  mouth wide open mid-strike, facing the viewer — and it happens to already be
  a proper pre-cut transparent PNG (real alpha channel, not a flat photo),
  which is what led to the "trust existing transparency" fix in
  `image-cutout.ts` above (`cutoutImageByLuminance()` detects this and passes
  it through untouched instead of recomputing alpha from luminance).
  `SnakeEffect` has no closed-mouth pose to animate from by design — it just
  cuts to this already-open-mouthed pose all at once when it lunges into view
  (see "bubaci/hra in detail" for why the emoji/hand-drawn versions before
  this one got replaced). `SnakeEffect` still tolerates a missing/failed image
  the same way `DementorEffect` does (renders nothing, banish/respawn state
  machine still runs).
- `famfrpal/zlatonka.png` — golden snitch source image for `famfrpal/hra`,
  resolved via `resolveImageUrl("/famfrpal/zlatonka")`. Supplied now — a
  trophy/statue-style shot, wings fully spread flat (~2.2:1 aspect ratio),
  already a proper pre-cut transparent PNG (real alpha, confirmed by sampling
  pixels directly — what looks like a solid green background in a quick
  preview is just the *viewer's* transparency matte, not baked into the file),
  so `cutoutImageByLuminance()` passes it through untouched, same as
  `had.png`. **This wide aspect ratio is why `GoldenSnitchEffect` sizes the
  image as `canvasWidth * IMAGE_WIDTH_FRACTION` (0.12, shrunk once from an
  initial 0.16 per live feedback that it looked too big) rather than relative
  to `BODY_RADIUS`** (the placeholder circle's own sizing, unaffected) — at the
  placeholder's scale this image would render tiny and paper-thin. If a
  future snitch image is a different (rounder) shape, that sizing constant is
  the thing to revisit; it exists specifically for this image's proportions,
  not because canvas-width-relative sizing is inherently better than
  radius-relative.

## Known open items / things awaiting live confirmation

- The current spell mapping (left=Expelliarmus, right=Nox, up=Wingardium
  Leviosa, Lumos=stricter-threshold down-swipe, Expelliarmus=fast-only
  left-swipe — see "Briefly renamed to Stupefy, then reverted" above for why
  it's Expelliarmus despite the lore mismatch with its bolt effect) and the
  five-spell guided tutorial (down-arrow, glow, "Skvělé!" → right-arrow,
  "Skvělé!" → green left-arrow, "Skvělé!" → feather, "Skvělé!" → voice-only
  Patronus, congratulations) landed after abandoning a letter-gesture ("draw
  an L") experiment that went through two failed implementations live — see
  "Lumos is deliberately not in SPELLS" above. Two rounds of live testing on
  Expelliarmus each caught a real problem: the first found `minAverageSpeed =
  2.2` basically unlandable (now `1.1`, confirmed working); the second found
  the bolt effect's first design (traveling orb + trail) didn't read as
  "lightning," now redesigned as an instant jagged zigzag flash (see
  "Expelliarmus fires a visual 'shot'" above) — **this newest bolt redesign
  has not itself been live-tested yet**. The raw-vs-mirrored coordinate fix
  that had left/right backwards (see "Mirroring" above) also hasn't been
  separately reconfirmed since the fix landed. If the new lightning shape
  needs tuning, `GROW_MS`/`HOLD_MS`/`FADE_MS`/`ZIGZAG_AMPLITUDE`/`SEGMENTS`
  in `spell-bolt-effect.ts` are the knobs (e.g. too fast to register, too
  subtle a zigzag, wrong total duration).
  **The Wingardium Leviosa feather (`feather-effect.ts`) is brand new and
  entirely untested live** — the rise/fall timing (`RISE_MS`/`RISE_DISTANCE`/
  `FALL_MS`/`FALL_DISTANCE`/sway constants), the hover offset above the wand
  tip, and even whether the feather is easy to actually see against a
  Hogwarts background image are all first-guess values.
  **The Patronus tutorial step (`teachPatronus()`) and the "patron" addition
  to `patronusListener`'s `extraWords` are also brand new and untested
  live** — swapping the per-session animal name for the fixed word "patron"
  already happened once in response to a live finding ("liška" specifically
  didn't work), so this exact word is itself unconfirmed; if it also proves
  unreliable, switching this listener to `"cs-CZ"` (and re-checking
  `matchesPatronusPhrase()` still catches "Expecto Patronum" from a Czech
  recognizer) is the next thing to try — see "Patronus voice recognition"
  above.
  **The guide/feather reveal-after-speech timing change (across all four
  gesture-based tutorial steps) is also unconfirmed live** — reasoned through,
  not observed; check the pacing doesn't feel like an awkward pause once the
  instruction finishes and before the guide appears.
- **`famfrpal/hra` (the golden-snitch mini-game) is brand new end to end and
  entirely untested live.** Specifically first-guess values: `SPEED_FRACTION_PER_SEC`
  (0.8, `golden-snitch-effect.ts` — bumped up from an initial `0.45` per the owner
  before any live test at all, so still not actually confirmed live, just the
  direction "faster"); `IMAGE_WIDTH_FRACTION` (0.12, `golden-snitch-effect.ts`
  — shrunk once from `0.16` per owner feedback ("zmenšit"), again before any
  live test, so the actual on-screen size still isn't confirmed);
  `CATCH_RADIUS_FRACTION` (0.07, `famfrpal/hra/page.tsx` — shrunk once from
  `0.09` per the same "zmenšit i ten kruh" feedback, tightening both the
  visual ring and the actual catch tolerance together since they share one
  constant) — untested against real hand-tracking jitter at typical webcam
  distance, and now a real open question whether it's still generous enough
  for small kids after being shrunk twice from the very first estimate;
  `RESPAWN_DELAY_MS` (900ms, `famfrpal/hra/page.tsx` — added after the owner
  asked for a pause between a catch and the next snitch appearing, where
  originally there was none at all) — untested live, so 900ms is a first
  guess at "a little longer than the instant respawn it replaced," not a
  confirmed feel; `RETARGET_MS` (0.4-0.9s, shortened from an initial 0.9-1.8s — at
  `SPEED_FRACTION_PER_SEC = 0.8` the snitch was reaching its target well
  before the old timer fired and then just sitting still until it did, which
  read as an unwanted pause; the shorter window retargets before/as it
  arrives so it stays closer to continuous motion, but this fix itself is
  unconfirmed live) — how erratic the wander behavior actually feels
  live at the new speed; and `SLOW_SPEED_MULTIPLIER` (0.45,
  `famfrpal/hra/page.tsx` — added along with the 4-mode `/famfrpal` setup
  screen so younger kids get a slower snitch, see "famfrpal/hra in detail"
  above) — a first guess at "half speed feels right," entirely untested live,
  and the interaction with `RETARGET_MS` at a much slower absolute speed
  hasn't been checked either (a slower snitch takes longer to reach any given
  target, so the same retarget window behaves differently than it does at
  full speed — might need its own tuning rather than assuming the fast-mode
  fix transfers). Round length (30s vs. 60s, `DEFAULT_ROUND_DURATION_S = 60`
  is just the fallback if `?duration=` is missing) is now the camp owner's
  choice per-round via `/famfrpal`'s tile picker rather than a single fixed
  value, so it's less of an open tuning question and more something to just
  pick per kid live.
  All are single constants at the top of `golden-snitch-effect.ts` or
  `famfrpal/hra/page.tsx`.
- The circle-gesture fix in `bubaci/hra` is verified only via synthetic
  in-browser test data, not yet confirmed with a real kid-drawn circle.
- The wand-tip extrapolation (`WAND_TIP_EXTENSION = 0.7`), the `dementor`
  variant's "loom behind the person" positioning (sized/anchored off
  `computeMaskBounds()`), and the `snake` variant's strike timing/feel
  (`STRIKE_DELAY_MS`, `LUNGE_MS`, etc. in `snake-effect.ts`) are all untested
  with a real camera + real kid — no camera access in this environment when
  they were built. Worth a live check once possible; each is just a small
  handful of tunable constants at the top of its file if something feels off
  (too subtle, too slow, wrong size, etc.).
- Ideas discussed but not built: house points system (skipped — the campers
  are preschool-age, unlikely to track a running score), a Sorting Hat
  activity (skipped — the owner has a real physical Sorting Hat for the
  event, so no in-app version needed).
- `bubaci/hra`'s background music (2:30-3:40 loop) got two live checks — the
  segment itself was fine, just too loud at `0.65` and then still at `0.5`,
  now `0.4` — that latest adjustment hasn't been re-confirmed live yet.
- `bubaci/hra` ends a round after `BANISH_LIMIT` (5) banishes and returns to
  `/` `ROUND_COMPLETE_REDIRECT_MS` (2000ms, shortened from 5000 on request)
  after the spoken congratulation. `famfrpal/hra` likewise returns to
  `/famfrpal` 5000ms after showing the final score.
- MediaPipe's WASM prints "INFO: Created TensorFlow Lite XNNPACK delegate
  for CPU." via `console.error`, which the Next dev overlay shows as a
  "Console Error". It's harmless; `silenceMediapipeInfoLogs()`
  (`src/lib/silence-mediapipe-logs.ts`, called at the top of every `*/hra`
  page's effect) drops `console.error` lines starting with `INFO:`.
- **`famfrpal` expert level** (`?speed=expert`, one 30s tile on
  `/famfrpal`, grid is now `grid-cols-5`): `EXPERT_SPEED_MULTIPLIER = 1.4`,
  and `GoldenSnitchEffect.setSpawnAnywhere(true)` makes `spawn()` pick a
  random point anywhere in frame at least `MIN_SPAWN_DISTANCE_FRACTION` (0.3
  of canvas width) away from the last tracked palm position — added because
  the default near-center spawn meant a hand parked mid-screen caught most
  respawns. Expert also uses `setRetargetMultiplier(0.5)` (direction
  changes every 200-450ms instead of 400-900ms) so it dodges more sharply.
  Untested live.
- **Boggart reaction photos** (`bubaci/hra`): each time a boggart appears
  (spider/dementor spawn, or each snake strike reaching "holding" — tracked
  via `SnakeEffect.getStrikeCount()`), a burst of 3 canvas JPEG snapshots
  (`PHOTO_DELAYS_MS` / `SNAKE_PHOTO_DELAYS_MS`) is POSTed to
  `src/app/api/photos/route.ts`, which writes them to
  `photos/bubaci/<timestamp>_<bubak>/` in the project root (one folder per
  page load, i.e. per kid). `/photos/` is gitignored — photos of kids, never
  commit them. Captures only the canvas (camera + boggart + trail), not the
  DOM text overlays. The on-screen snake covers the kid's face at peak
  strike, so snake strikes *additionally* save a "portrait" per burst shot
  (`captureSnakePortrait()`, label `snake-portrait-N`): an off-screen
  composite of camera → smaller snake (`SnakeEffect.drawPortrait()`,
  `SNAKE_PORTRAIT_*` constants) beside/above the last known face → the
  segmented kid on top, so the snake appears *behind* them (confirmed
  working on a real photo).
- **Photo storage** is shared: `src/lib/photo-store.ts` (server — paths,
  validation, `listSessions()`; all request-derived paths go through
  `photosPath()` with a `turbopackIgnore` comment so `next build` doesn't
  trace the whole project), `src/app/api/photos/` (`POST` image, `GET` list,
  `file/` serves one JPEG, `meta/` merges `meta.json`), and
  `src/lib/photo-upload.ts` (client helpers). Games allowed: `bubaci`,
  `kouzla`.
- **Patronus photos** (`kouzla/hra`): every cast saves 3 shots
  (`PATRONUS_PHOTO_DELAYS_MS`, timed to the effect's full-visibility
  window). Not raw canvas snapshots — on screen the Patronus is drawn over
  everyone and hid the kid's face, so `composePatronusPhoto()` builds each
  one off-screen: background → Patronus (`PatronusEffect.drawPortrait()`,
  `PATRONUS_PHOTO_*` constants) centered in whichever side gap next to the
  kid is wider (kid bounds via `computeMaskBounds()` on that frame's mask)
  → mirrored kid cutout on top, so the Patronus stands *behind/beside*
  them. The timeouts only set `pendingPhotoLabel`; `loop()` takes the shot
  on the next frame since it needs that frame's mask + cut-out person
  canvas (confirmed working live). The page stays open for a whole line of kids, so each N press
  starts a new `…_tutorial` session (casts before any N go to
  `…_volna-hra`); the tutorial writes `{ patronus }` to its meta.json up
  front and `{ name }` once heard — `askForName()` (new in
  `voice-greeting.ts`) returns the nominative for the diploma alongside the
  vocative for the greeting; `askForVocativeName()` is now a thin wrapper.
  `PATRONUS_CATALOG` is imported by `kouzla/hra` again for the label.
  Untested live.
- The Mac this runs on has had recurring swap/memory pressure (dev server getting
  killed by "system low on memory", swap seen at 93-95% full). A full restart
  fixed it before; if the dev server keeps dying immediately after restart, that's
  the first thing to check (`sysctl vm.swapusage`) rather than assuming a code
  regression.
