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
  type (`spiders`, `dementor`, or `snake`), links to `/bubaci/hra?bubak=<id>`.
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
  differently (one landmark for aim, not six for crawling).

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
- **`spell-sounds.ts`** — `playSpellSound(id)`, all sounds are synthesized with the
  Web Audio API (oscillator sweeps + short "sparkle" note sequences) — no audio
  files. `SpellId` = `"lumos" | "nox" | "wingardium" | "expelliarmus" | "patronus" | "banish"`.
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
    (2:30-3:40), at volume `BUBACI_MUSIC_VOLUME = 0.65` (louder/more tense —
    the owner explicitly wanted this one dramatic, it's the scary-boggart
    game). Needs an extra `onLoadedMetadata` handler (`kouzla/hra` doesn't)
    to seek to `BUBACI_MUSIC_START_SECONDS` once, since this loop doesn't
    start at `0:00` like the other one does.
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
- `layout.tsx` still has the default `create-next-app` metadata (`title: "Create
  Next App"`) — never customized, purely cosmetic (browser tab title), harmless.
- Ideas discussed but not built: house points system, a Sorting Hat activity.
- `bubaci/hra`'s background music (2:30-3:40 loop, volume 0.65) is brand new
  and untested live — whether that segment/volume actually reads as
  "dramatic" against real gameplay + spell sound effects, or just as loud,
  hasn't been checked with a real kid and TV speakers yet.
- The Mac this runs on has had recurring swap/memory pressure (dev server getting
  killed by "system low on memory", swap seen at 93-95% full). A full restart
  fixed it before; if the dev server keeps dying immediately after restart, that's
  the first thing to check (`sysctl vm.swapusage`) rather than assuming a code
  regression.
