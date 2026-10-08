"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HandLandmarker, ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";
import { GestureDetector, Direction } from "@/lib/gesture-detector";
import { WandTrailEffect } from "@/lib/wand-trail";
import { SpellBoltEffect } from "@/lib/spell-bolt-effect";
import { FeatherEffect } from "@/lib/feather-effect";
import { playSpellSound, SpellId } from "@/lib/spell-sounds";
import { silenceMediapipeInfoLogs } from "@/lib/silence-mediapipe-logs";
import { WASM_BASE, HAND_MODEL_URL, SEGMENTER_MODEL_URL } from "@/lib/mediapipe-assets";
import { applyMaskAlpha, computeMaskBounds, NormalizedBounds } from "@/lib/background-composite";
import { PatronusEffect } from "@/lib/patronus-effect";
import { startPatronusListener } from "@/lib/voice-recognition";
import { askForName, speak } from "@/lib/voice-greeting";
import { newPhotoSession, saveSessionMeta, uploadCanvasPhoto } from "@/lib/photo-upload";
import { PATRONUS_CATALOG } from "@/lib/patronus-catalog";
import { resolveImageUrl } from "@/lib/resolve-asset";
import { asset, WEB_BUILD } from "@/lib/web-build";

// Lumos and Expelliarmus are deliberately not in this map — each has its own
// dedicated, stricter GestureDetector instance (see lumosDetectorRef /
// expelliarmusDetectorRef below): Lumos needs a bigger down-swipe than
// left/right/up require, Expelliarmus needs a genuinely fast left-swipe, not
// just any left-swipe. Only right/up dispatch through this generic map.
type SwipeSpellDirection = Exclude<Direction, "down" | "left">;

// ms after a Patronus cast — its fade-in is 600ms and hold 2200ms (see
// patronus-effect.ts), so these land while it's fully visible.
const PATRONUS_PHOTO_DELAYS_MS = [900, 1600, 2400] as const;
// On screen the Patronus is drawn over everyone, which in a photo hides
// the kid — so photos are composed separately: background → Patronus on
// whichever side of the kid has more room → kid cutout on top. Sizes are
// fractions of the canvas; the threshold is for finding the kid's bounds.
const PATRONUS_PHOTO_MAX_W = 0.45;
const PATRONUS_PHOTO_MAX_H = 0.7;
const PERSON_MASK_THRESHOLD = 0.5;

const SPELLS: Record<SwipeSpellDirection, { id: SpellId; label: string }> = {
  right: { id: "nox", label: "Nox!" },
  up: { id: "wingardium", label: "Wingardium Leviosa!" },
};

const EXPELLIARMUS_BOLT_COLOR = "#22ff6a";

// If the background/person swap looks backwards once you test it (person
// disappears, background shows through where the person is), just flip this.
const INVERT_SEGMENTATION_MASK = false;

const MUSIC_LOOP_END_SECONDS = 2 * 60 + 20; // 2:20

type Status = "loading" | "ready" | "error";

const LOADING_MESSAGES: Record<string, string> = {
  camera: "Žádám o přístup ke kameře...",
  wasm: "Stahuji kouzelnou knihovnu...",
  model: "Stahuji kouzelný rozum (může to chvíli trvat na horším připojení)...",
  segmenter: "Připravuji pozadí...",
};

function WandGamePageInner() {
  const searchParams = useSearchParams();
  const backgroundId = searchParams.get("bg") ?? "1";
  const patronusId = searchParams.get("patronus") ?? "1";
  // Extension is resolved at runtime (see resolveImageUrl) so it doesn't
  // matter whether a dropped-in photo is .jpg, .jpeg, .png or .webp.
  const backgroundBasePath = `/backgrounds/${backgroundId}`;
  const patronusBasePath = `/patronus/${patronusId}`;
  const patronusLabel = PATRONUS_CATALOG.find((p) => p.id === patronusId)?.label ?? "";

  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundImgRef = useRef<HTMLImageElement | null>(null);
  const detectorRef = useRef(new GestureDetector());
  // Separate instance, much larger minDistance: makes Lumos require a
  // bigger, more deliberate down-swipe than left/right/up need, so an
  // incidental small downward hand movement (lowering the wand between
  // casts, adjusting grip, etc.) doesn't cast it as easily by accident.
  const lumosDetectorRef = useRef(new GestureDetector(900, 0.3));
  // Separate instance, higher minAverageSpeed: Expelliarmus needs a genuinely
  // fast left-swipe (it's meant to feel like snapping off a shot), not just
  // any left-swipe at the normal minDistance/speed. 2.2 turned out way too
  // strict on the first live test (basically unlandable) — dropped to 1.1,
  // still above MOVE_SPEED_THRESHOLD (0.9 in gesture-detector.ts) so it's
  // not just "any swipe at all", but far more forgiving than the first try.
  const expelliarmusDetectorRef = useRef(new GestureDetector(900, 0.18, 1.1));
  const trailEffectRef = useRef(new WandTrailEffect(500));
  const patronusRef = useRef(new PatronusEffect());
  const boltEffectRef = useRef(new SpellBoltEffect());
  const featherEffectRef = useRef(new FeatherEffect());
  // Updated every frame the hand is tracked (raw pre-mirror pixel coords,
  // same space as the trail). teachWingardium() needs "where is the wand tip
  // right now" to spawn the feather there, but it runs from an async
  // tutorial-flow function outside loop()'s per-frame closure.
  const lastHandTipRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const tutorialStepRef = useRef<
    | "pending"
    | "guide-lumos"
    | "learning"
    | "guide-nox"
    | "guide-expelliarmus"
    | "guide-wingardium"
    | "guide-patronus"
    | "done"
  >("pending");
  const lumosGlowStartRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [loadingStep, setLoadingStep] = useState<keyof typeof LOADING_MESSAGES>("camera");
  const [errorMsg, setErrorMsg] = useState("");
  const [spellText, setSpellText] = useState<string | null>(null);
  const spellTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [greetingText, setGreetingText] = useState<string | null>(null);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = 0.35;
  }, []);

  useEffect(() => {
    // Best-effort — works if the browser already considers this page
    // "engaged" (e.g. after the earlier camera permission prompt). If not,
    // the click-to-fullscreen handler above is the guaranteed fallback.
    if (status === "ready") musicRef.current?.play().catch(() => {});
  }, [status]);

  useEffect(() => {
    silenceMediapipeInfoLogs();
    let cancelled = false;
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let imageSegmenter: ImageSegmenter | null = null;
    const music = musicRef.current;

    // Patronus photos: each cast saves a few composed shots (see
    // PATRONUS_PHOTO_* above) into photos/kouzla/<session>/. The timeouts
    // only *request* a shot; loop() takes it on the next frame, since it
    // needs that frame's segmentation mask (for the kid's bounds) and
    // freshly cut-out person canvas.
    // This page stays open for a whole line of kids (N starts each one's
    // tutorial), so a fresh session — one folder per kid — starts on every
    // N press; casts before the first N go to a "volna-hra" session. The
    // tutorial also stores the kid's name + patronus in that session's
    // meta.json, which /diplomy uses for the printable diploma.
    let photoSession = newPhotoSession("volna-hra");
    const photoTimeouts = new Set<ReturnType<typeof setTimeout>>();
    let pendingPhotoLabel: string | null = null;
    function capturePatronusPhotos() {
      PATRONUS_PHOTO_DELAYS_MS.forEach((delay, i) => {
        const t = setTimeout(() => {
          photoTimeouts.delete(t);
          pendingPhotoLabel = `patronus-${i + 1}`;
        }, delay);
        photoTimeouts.add(t);
      });
    }

    function composePatronusPhoto(label: string, person: HTMLCanvasElement, bounds: NormalizedBounds | null) {
      const w = person.width;
      const h = person.height;
      const photo = document.createElement("canvas");
      photo.width = w;
      photo.height = h;
      const ctx = photo.getContext("2d")!;

      const bg = backgroundImgRef.current;
      if (bg) ctx.drawImage(bg, 0, 0, w, h);
      else {
        ctx.fillStyle = "#0a0a12";
        ctx.fillRect(0, 0, w, h);
      }

      // Bounds are in raw (unmirrored) space; the kid is drawn mirrored, so
      // their on-screen center is 1 - raw center.
      const kidX = bounds ? 1 - (bounds.minX + bounds.maxX) / 2 : 0.5;
      const kidY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0.5;
      const patronusX = kidX > 0.5 ? kidX / 2 : kidX + (1 - kidX) / 2;
      const drawn = patronusRef.current.drawPortrait(
        ctx,
        patronusX * w,
        Math.min(kidY, 0.55) * h,
        w * PATRONUS_PHOTO_MAX_W,
        h * PATRONUS_PHOTO_MAX_H
      );
      if (!drawn) return;

      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-w, 0);
      ctx.drawImage(person, 0, 0);
      ctx.restore();

      uploadCanvasPhoto("kouzla", photoSession, label, photo);
    }

    // Each of these is idempotent (null-guarded + nulls itself out), so it's
    // safe to call from both a cancellation checkpoint inside init() and the
    // effect's own cleanup below without double-disposing anything. This
    // matters because React (in dev, via Strict Mode) mounts every effect
    // twice — without this, a slow-resolving getUserMedia/model-load that
    // finishes *after* the first mount's cleanup already ran would leak a
    // live camera stream / GPU-backed ML model that nothing ever releases,
    // and those pile up across refreshes until the tab bogs down.
    function releaseStream() {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }
    function releaseHandLandmarker() {
      if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
      }
    }
    function releaseImageSegmenter() {
      if (imageSegmenter) {
        imageSegmenter.close();
        imageSegmenter = null;
      }
    }
    function releaseAll() {
      releaseStream();
      releaseHandLandmarker();
      releaseImageSegmenter();
    }

    resolveImageUrl(backgroundBasePath)
      .then((url) => {
        const bgImg = new Image();
        bgImg.onload = () => {
          if (!cancelled) backgroundImgRef.current = bgImg;
        };
        bgImg.src = url;
      })
      .catch((err) =>
        console.warn(`[wand] no background image found for ${backgroundBasePath}, using plain background:`, err)
      );

    resolveImageUrl(patronusBasePath)
      .then((url) => patronusRef.current.loadShape(url))
      .catch((err) => console.warn("[wand] failed to load patronus shape:", err));

    function triggerPatronus() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      console.log("[wand] Expecto Patronum recognized!");
      patronusRef.current.trigger(canvas.width, canvas.height);
      playSpellSound("patronus");
      capturePatronusPhotos();
      setSpellText("Expecto Patronum!");
      if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
      spellTimeoutRef.current = setTimeout(() => setSpellText(null), 2500);

      // One shared trigger regardless of which path recognized it (the
      // phrase or the animal-name fallback — see teachPatronus()), so the
      // tutorial-advance logic only has to live in one place.
      if (tutorialStepRef.current === "guide-patronus") {
        tutorialStepRef.current = "done";
        celebrateTutorialComplete();
      }
    }

    // "patron" (not the specific animal name — "liška" turned out to be
    // unreliable for the recognizer to catch) as an easier-to-say fallback
    // alongside "Expecto Patronum", on the same always-on listener.
    const patronusListener = startPatronusListener(triggerPatronus, ["patron"]);

    let introInProgress = false;
    let praiseTimeout: ReturnType<typeof setTimeout> | null = null;

    // The ideal flow: ask the child's name, greet them, then walk them
    // through their first two spells in sequence — Lumos (trace an "L" with
    // the wand) then Nox (swipe right) — each with a spoken instruction and
    // an on-screen guide that only goes away once that gesture actually
    // lands. The Lumos->Nox handoff (praise, then the next instruction)
    // happens from inside loop() when the gesture completes (see
    // castSpell/praiseThen below), not here — this function only gets the
    // child to the starting line.
    async function runIntroTutorial() {
      if (introInProgress) return;
      introInProgress = true;
      tutorialStepRef.current = "pending";
      patronusListener.setPaused(true);
      photoSession = newPhotoSession("tutorial");
      saveSessionMeta("kouzla", photoSession, { patronus: patronusLabel });
      try {
        setGreetingText("...");
        const heard = await askForName(setGreetingText);
        if (cancelled) return;
        if (heard) saveSessionMeta("kouzla", photoSession, { name: heard.name });

        const name = heard?.vocative ?? "kouzelníku";
        const greeting = `Ahoj, ${name}!`;
        setGreetingText(greeting);
        await speak(greeting);
        if (cancelled) return;

        const instruction =
          "Teď zkus své první kouzlo! Zkusíme rozsvítit lampu. Máchni hůlkou dolů a řekni: Lumos!";
        setGreetingText(instruction);
        await speak(instruction);
        if (cancelled) return;
        tutorialStepRef.current = "guide-lumos"; // shows the down-arrow guide, only once the instruction has actually finished
        // Text + guide stay on screen until the down-swipe actually lands.
      } finally {
        patronusListener.setPaused(false);
        introInProgress = false;
      }
    }

    // Called once the down-swipe lands during the tutorial — praises, then
    // teaches Nox. Separate from runIntroTutorial because this fires from
    // inside loop()'s per-frame gesture handling, not from the initial
    // name-greeting flow.
    async function teachNox() {
      if (cancelled) return;
      const instruction = "Nyní zkusíme světlo zhasnout. Řekni Nox a máchni hůlkou doprava.";
      setGreetingText(instruction);
      await speak(instruction);
      if (cancelled) return;
      tutorialStepRef.current = "guide-nox"; // shows the right-arrow guide, only once the instruction has actually finished
      // Text + guide stay on screen until the right-swipe actually lands.
    }

    // Called once the right-swipe lands during the tutorial — praises, then
    // teaches Expelliarmus.
    async function teachExpelliarmus() {
      if (cancelled) return;
      const instruction = "Teď něco pořádného: Expelliarmus! Rychle mávni hůlkou doleva!";
      setGreetingText(instruction);
      await speak(instruction);
      if (cancelled) return;
      tutorialStepRef.current = "guide-expelliarmus"; // shows the left-arrow guide, only once the instruction has actually finished
      // Text + guide stay on screen until a fast left-swipe actually lands.
    }

    // Called once the fast left-swipe lands during the tutorial — praises,
    // then teaches Wingardium Leviosa. Unlike the others, this one shows a
    // feather (hovering at the current wand-tip position) instead of a
    // directional arrow — it's the whole point of this step.
    async function teachWingardium() {
      if (cancelled) return;
      const instruction = "A teď to nejkouzelnější: Wingardium Leviosa! Zvedni pírko mávnutím nahoru.";
      setGreetingText(instruction);
      await speak(instruction);
      if (cancelled) return;
      tutorialStepRef.current = "guide-wingardium";
      const tip = lastHandTipRef.current;
      featherEffectRef.current.show(tip.x, tip.y); // only appears once the instruction has actually finished
      // Text + feather stay on screen until the up-swipe actually lands.
    }

    // Called once the up-swipe lands during the tutorial — praises, then
    // teaches Patronus, the last of the five guided spells. The gesture
    // "doesn't matter" here (per the owner) — casting is voice-only, same as
    // free play — so there's no arrow/shape guide for this step, just the
    // spoken instruction. No fallback timer/second recognition session
    // needed: `patronusListener` (started below) already matches this
    // session's animal name on the exact same always-on listener as the
    // "Expecto Patronum" phrase, so both are live from the first second —
    // triggerPatronus() (below) handles the tutorial-advance regardless of
    // which one a kid actually says.
    async function teachPatronus() {
      if (cancelled) return;
      const instruction =
        "Poslední a nejsilnější kouzlo: vyčaruj svého Patrona! Řekni Expecto Patronum, nebo jen slovo patron, a mávni hůlkou.";
      setGreetingText(instruction);
      tutorialStepRef.current = "guide-patronus";
      await speak(instruction);
      // Text stays on screen until Patronus actually triggers.
    }

    // Shared "Skvělé!" praise beat used after tutorial gestures land —
    // delayed slightly so whatever visual feedback the spell itself causes
    // (the Lumos glow, the lamp toggling) is already visible before the
    // praise text/speech lands on top of it.
    function praiseThen(after?: () => void) {
      if (praiseTimeout) clearTimeout(praiseTimeout);
      praiseTimeout = setTimeout(() => {
        praiseTimeout = null;
        setSpellText("Skvělé!");
        if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
        spellTimeoutRef.current = setTimeout(() => setSpellText(null), 1500);
        speak("Skvělé!")
          .then(() => {
            if (!cancelled) after?.();
          })
          .catch(() => {});
      }, 600);
    }

    // The tutorial's closing beat, after Patronus — a longer congratulation
    // instead of another "Skvělé!", delayed a bit more than praiseThen's
    // 600ms so the Patronus effect's own fade-in (600ms) has room to land
    // first. Shown via greetingText (the instruction banner) rather than
    // spellText, since it's a full sentence, not a short exclamation.
    function celebrateTutorialComplete() {
      if (praiseTimeout) clearTimeout(praiseTimeout);
      praiseTimeout = setTimeout(() => {
        praiseTimeout = null;
        const message = "Skvěle! Zvládl jsi svá první kouzla — jsi opravdový kouzelník!";
        setGreetingText(message);
        speak(message)
          .then(() => {
            if (!cancelled) setGreetingText(null);
          })
          .catch(() => {});
      }, 1200);
    }

    // Manual triggers: P = patronus, N = name-greeting + first-spell
    // tutorial. N is deliberately manual (not auto-started) so it can be
    // fired exactly when a child is ready, e.g. while the next kid in line
    // is still getting into position.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "p" || e.key === "P") triggerPatronus();
      if (e.key === "n" || e.key === "N") runIntroTutorial();
    }
    window.addEventListener("keydown", onKeyDown);

    async function init() {
      try {
        console.log("[wand] requesting getUserMedia...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        console.log("[wand] got camera stream", stream.getVideoTracks());
        if (cancelled) {
          releaseStream();
          return;
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        console.log("[wand] video playing", video.videoWidth, video.videoHeight);

        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const personCanvas = document.createElement("canvas");
        personCanvas.width = video.videoWidth;
        personCanvas.height = video.videoHeight;
        personCanvasRef.current = personCanvas;

        if (cancelled) {
          releaseStream();
          return;
        }
        setLoadingStep("wasm");
        console.log("[wand] loading wasm fileset...");
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        console.log("[wand] wasm fileset loaded");

        if (cancelled) {
          releaseStream();
          return;
        }
        setLoadingStep("model");
        console.log("[wand] loading hand landmarker model...");
        try {
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
          console.log("[wand] hand model loaded with GPU delegate");
        } catch (gpuErr) {
          console.log("[wand] GPU delegate failed, trying CPU", gpuErr);
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
          console.log("[wand] hand model loaded with CPU delegate");
        }

        if (cancelled) {
          releaseAll();
          return;
        }
        setLoadingStep("segmenter");
        console.log("[wand] loading segmenter model...");
        try {
          imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
          console.log("[wand] segmenter loaded with GPU delegate");
        } catch (gpuErr) {
          console.log("[wand] segmenter GPU delegate failed, trying CPU", gpuErr);
          imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
          console.log("[wand] segmenter loaded with CPU delegate");
        }

        if (cancelled) {
          releaseAll();
          return;
        }
        setStatus("ready");
        console.log("[wand] ready!");
        loop();
      } catch (err) {
        console.error("[wand] init failed:", err);
        if (cancelled) {
          releaseAll();
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }

    function castSpell(id: SpellId, label: string) {
      playSpellSound(id);
      setSpellText(label);
      if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
      spellTimeoutRef.current = setTimeout(() => setSpellText(null), 1200);

      // Best-effort: toggles a real lamp plugged into a HomeKit smart plug via
      // a local macOS Shortcut (see src/app/api/lamp/route.ts). Fire-and-forget
      // — a missing/unpaired plug or a Shortcut that hasn't been set up yet
      // must never break the game.
      if (!WEB_BUILD && (id === "lumos" || id === "nox")) {
        fetch("/api/lamp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: id === "lumos" ? "on" : "off" }),
        }).catch((err) => console.warn("[wand] lamp toggle failed:", err));
      }
    }

    function triggerSpell(direction: SwipeSpellDirection) {
      const spell = SPELLS[direction];
      castSpell(spell.id, spell.label);
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const personCanvas = personCanvasRef.current;
      if (!video || !canvas || !personCanvas || !handLandmarker || !imageSegmenter) return;

      const ctx = canvas.getContext("2d")!;
      const personCtx = personCanvas.getContext("2d", { willReadFrequently: true })!;

      if (video.readyState >= 2) {
        const now = performance.now();

        // 1) Draw the background (or a plain fallback).
        const bg = backgroundImgRef.current;
        if (bg) {
          ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#0a0a12";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // 2) Cut the person out of the raw camera frame and draw them on top.
        personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
        const segResult = imageSegmenter.segmentForVideo(video, now);
        const mask = segResult.confidenceMasks?.[0];
        if (mask) {
          const maskData = mask.getAsFloat32Array();
          const photoLabel = pendingPhotoLabel;
          const photoBounds = photoLabel
            ? computeMaskBounds(maskData, mask.width, mask.height, PERSON_MASK_THRESHOLD, INVERT_SEGMENTATION_MASK)
            : null;
          applyMaskAlpha(
            personCtx,
            personCanvas.width,
            personCanvas.height,
            maskData,
            mask.width,
            mask.height,
            INVERT_SEGMENTATION_MASK
          );
          mask.close();
          if (photoLabel) {
            pendingPhotoLabel = null;
            composePatronusPhoto(photoLabel, personCanvas, photoBounds);
          }
        }

        // Only the person (+ the trail drawn on top of them) is mirrored —
        // the background image stays in its real, unflipped orientation.
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);

        ctx.drawImage(personCanvas, 0, 0);

        // 3) Track the fingertip and draw the spell trail on top of everything.
        const handResult = handLandmarker.detectForVideo(video, now);
        const hand = handResult.landmarks[0];

        if (hand) {
          const tip = hand[8]; // index fingertip
          const px = tip.x * canvas.width;
          const py = tip.y * canvas.height;

          trailEffectRef.current.addPoint(px, py, now);
          trailEffectRef.current.render(ctx, now);
          lastHandTipRef.current = { x: px, y: py };
          featherEffectRef.current.updateIdlePosition(px, py);

          // Gesture detection needs the *mirrored* x, not the raw one: `tip`
          // comes straight from HandLandmarker on the unmirrored `video`
          // element, but everything the player actually sees (the person
          // layer, the trail dot above) is drawn through the mirror
          // transform. Left/right swipe classification has to match what's
          // on screen (and the player's own physical left/right in this
          // self-view mirror), or "swipe right" ends up classified as
          // "left" and vice versa — exactly what made Nox fire on the wrong
          // side of a fresh live test once the tutorial started calling out
          // an explicit on-screen direction for it. Up/down aren't affected
          // (mirroring is horizontal only), so `tip.y` is used as-is.
          const mirroredX = 1 - tip.x;

          const direction = detectorRef.current.addSample(mirroredX, tip.y, now);
          if (direction && direction !== "down" && direction !== "left") {
            triggerSpell(direction);
            if (direction === "right" && tutorialStepRef.current === "guide-nox") {
              tutorialStepRef.current = "learning";
              setGreetingText(null);
              praiseThen(teachExpelliarmus);
            }
            if (direction === "up") {
              // No-ops unless the feather is currently idle (i.e. the
              // Wingardium tutorial step actually showed it) — safe to call
              // on every free-play up-swipe too.
              featherEffectRef.current.liftoff(now);
              if (tutorialStepRef.current === "guide-wingardium") {
                tutorialStepRef.current = "learning";
                setGreetingText(null);
                praiseThen(teachPatronus);
              }
            }
          }

          // Lumos: a separate, stricter-threshold detector (see
          // lumosDetectorRef above) — only its "down" result matters here.
          const lumosDirection = lumosDetectorRef.current.addSample(mirroredX, tip.y, now);
          if (lumosDirection === "down") {
            castSpell("lumos", "Lumos!");
            // Lumos always flashes the scene brighter, tutorial or not —
            // it's the light spell, so every cast should light things up.
            lumosGlowStartRef.current = now;
            if (tutorialStepRef.current === "guide-lumos") {
              tutorialStepRef.current = "learning";
              setGreetingText(null);
              // Let the glow actually flash on screen for a moment before
              // the praise (and then the Nox instruction) land, so they
              // don't overlap.
              praiseThen(teachNox);
            }
          }

          // Expelliarmus: a separate detector requiring a genuinely fast
          // swipe (see expelliarmusDetectorRef above) — only its "left"
          // result matters here.
          const expelliarmusDirection = expelliarmusDetectorRef.current.addSample(mirroredX, tip.y, now);
          if (expelliarmusDirection === "left") {
            castSpell("expelliarmus", "Expelliarmus!");
            // Fired from wherever the wand tip currently is, mirrored to
            // match the displayed (mirrored) position — the trail dot and
            // the person layer both live in that same mirrored space.
            const displayX = canvas.width - px;
            boltEffectRef.current.trigger(
              { x: displayX, y: py },
              { x: -1, y: 0 },
              canvas.width * 1.05,
              EXPELLIARMUS_BOLT_COLOR
            );
            if (tutorialStepRef.current === "guide-expelliarmus") {
              tutorialStepRef.current = "learning";
              setGreetingText(null);
              praiseThen(teachWingardium);
            }
          }
        }

        // Drawn inside the mirror transform (unlike the bolt) since it
        // hovers relative to the wand tip's on-screen position while idle —
        // same space as the trail dot. Runs unconditionally (not gated on
        // `hand`) so the rise/fall animation keeps playing even on a frame
        // where hand tracking briefly drops.
        featherEffectRef.current.render(ctx, now);

        ctx.restore();

        // 4) The patron effect is a screen-space overlay, not mirrored with
        // the person, so it's drawn after restoring the mirror transform.
        patronusRef.current.update(now);
        patronusRef.current.render(ctx, now);
        boltEffectRef.current.render(ctx, now);

        // 5) Tutorial guides (screen-space, not mirrored) — hand-drawn glowing
        // shapes, not emoji icons, so they read as "trace this path" rather
        // than a static symbol. Only one is ever shown, gated by the current
        // tutorial step.
        if (tutorialStepRef.current === "guide-lumos") {
          // A plain downward arrow — thin shaft + triangular arrowhead.
          const bounce = Math.sin(now / 500) * 16;
          const glowPulse = 0.7 + Math.sin(now / 350) * 0.3;
          const cx = canvas.width / 2;
          const topY = canvas.height * 0.16 + bounce;
          const shaftLength = canvas.height * 0.26;
          const headWidth = 34;
          const headHeight = 40;
          const tipY = topY + shaftLength;

          ctx.save();
          ctx.strokeStyle = `rgba(250, 204, 21, ${glowPulse})`;
          ctx.fillStyle = `rgba(250, 204, 21, ${glowPulse})`;
          ctx.shadowColor = "#facc15";
          ctx.shadowBlur = 24;
          ctx.lineWidth = 5;
          ctx.lineCap = "round";

          ctx.beginPath();
          ctx.moveTo(cx, topY);
          ctx.lineTo(cx, tipY - headHeight);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cx - headWidth / 2, tipY - headHeight);
          ctx.lineTo(cx + headWidth / 2, tipY - headHeight);
          ctx.lineTo(cx, tipY);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        } else if (tutorialStepRef.current === "guide-nox") {
          // A plain rightward arrow — same shape as the old down-arrow,
          // rotated: shaft + arrowhead.
          const bounce = Math.sin(now / 500) * 16;
          const glowPulse = 0.7 + Math.sin(now / 350) * 0.3;
          const cy = canvas.height * 0.3 + bounce;
          const startX = canvas.width * 0.36;
          const shaftLength = canvas.width * 0.16;
          const headWidth = 34;
          const headHeight = 40;
          const tipX = startX + shaftLength;

          ctx.save();
          ctx.strokeStyle = `rgba(250, 204, 21, ${glowPulse})`;
          ctx.fillStyle = `rgba(250, 204, 21, ${glowPulse})`;
          ctx.shadowColor = "#facc15";
          ctx.shadowBlur = 24;
          ctx.lineWidth = 5;
          ctx.lineCap = "round";

          ctx.beginPath();
          ctx.moveTo(startX, cy);
          ctx.lineTo(tipX - headHeight, cy);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(tipX - headHeight, cy - headWidth / 2);
          ctx.lineTo(tipX - headHeight, cy + headWidth / 2);
          ctx.lineTo(tipX, cy);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        } else if (tutorialStepRef.current === "guide-expelliarmus") {
          // A plain leftward arrow, colored to match the spell's green bolt,
          // with a faster pulse than the others to hint "do this quickly".
          const bounce = Math.sin(now / 350) * 16;
          const glowPulse = 0.7 + Math.sin(now / 220) * 0.3;
          const cy = canvas.height * 0.3 + bounce;
          const rightX = canvas.width * 0.64;
          const shaftLength = canvas.width * 0.16;
          const headWidth = 34;
          const headHeight = 40;
          const tipX = rightX - shaftLength;

          ctx.save();
          ctx.strokeStyle = `rgba(34, 255, 106, ${glowPulse})`;
          ctx.fillStyle = `rgba(34, 255, 106, ${glowPulse})`;
          ctx.shadowColor = EXPELLIARMUS_BOLT_COLOR;
          ctx.shadowBlur = 24;
          ctx.lineWidth = 5;
          ctx.lineCap = "round";

          ctx.beginPath();
          ctx.moveTo(rightX, cy);
          ctx.lineTo(tipX + headHeight, cy);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(tipX + headHeight, cy - headWidth / 2);
          ctx.lineTo(tipX + headHeight, cy + headWidth / 2);
          ctx.lineTo(tipX, cy);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        }

        // 6) Lumos glow — brightens the whole scene for a moment, fading out.
        if (lumosGlowStartRef.current !== null) {
          const GLOW_DURATION_MS = 1500;
          const elapsed = now - lumosGlowStartRef.current;
          if (elapsed < GLOW_DURATION_MS) {
            const alpha = (1 - elapsed / GLOW_DURATION_MS) * 0.5;
            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = `rgba(255,250,220,${alpha})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          } else {
            lumosGlowStartRef.current = null;
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      releaseAll();
      patronusListener.stop();
      if (praiseTimeout) clearTimeout(praiseTimeout);
      window.speechSynthesis?.cancel();
      music?.pause();
      window.removeEventListener("keydown", onKeyDown);
      if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
      photoTimeouts.forEach(clearTimeout);
    };
  }, [backgroundBasePath, patronusBasePath, patronusLabel]);

  function toggleFullscreen() {
    // Browsers block audio autoplay until a real user gesture — this click
    // handler already exists for fullscreen, so it doubles as the reliable
    // way to start the background music too.
    musicRef.current?.play().catch(() => {});

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  return (
    <main
      onClick={toggleFullscreen}
      className="relative min-h-screen bg-black overflow-hidden flex items-center justify-center cursor-pointer"
    >
      <video ref={videoRef} className="absolute w-px h-px opacity-0" playsInline muted />
      <audio
        ref={musicRef}
        src={asset("/music/background.mp3")}
        preload="auto"
        onTimeUpdate={(e) => {
          // Loop just the first 2:20 of the track instead of the whole
          // file — no need to actually trim the mp3.
          if (e.currentTarget.currentTime >= MUSIC_LOOP_END_SECONDS) {
            e.currentTarget.currentTime = 0;
          }
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {status === "loading" && (
        <p className="absolute text-white text-xl text-center px-6">
          {LOADING_MESSAGES[loadingStep]}
        </p>
      )}
      {status === "error" && (
        <p className="absolute text-red-400 text-center px-6">
          Chyba přístupu ke kameře: {errorMsg}
        </p>
      )}

      {spellText && (
        <p className="absolute top-10 left-1/2 -translate-x-1/2 text-4xl font-bold text-yellow-300 drop-shadow-lg animate-pulse">
          {spellText}
        </p>
      )}

      {greetingText && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 text-3xl font-semibold text-blue-200 drop-shadow-lg text-center px-6">
          {greetingText}
        </p>
      )}

      {status === "ready" && (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-sm">
          klikni pro fullscreen
        </p>
      )}
    </main>
  );
}

// useSearchParams() needs a Suspense boundary for `next build` (production
// mode) — the page itself is fully client-side, so the fallback is just
// the same black screen it starts on anyway.
export default function WandGamePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <WandGamePageInner />
    </Suspense>
  );
}
