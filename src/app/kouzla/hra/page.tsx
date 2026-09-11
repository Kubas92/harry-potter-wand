"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HandLandmarker, ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";
import { GestureDetector, Direction } from "@/lib/gesture-detector";
import { playSpellSound, SpellId } from "@/lib/spell-sounds";
import { applyMaskAlpha } from "@/lib/background-composite";
import { PatronusEffect } from "@/lib/patronus-effect";
import { startPatronusListener } from "@/lib/voice-recognition";
import { askForVocativeName, speak } from "@/lib/voice-greeting";
import { resolveImageUrl } from "@/lib/resolve-asset";

// down is the guided first spell taught in the intro tutorial (see
// runIntroTutorial) — kept in sync with the "wave down for Lumos" wording.
const SPELLS: Record<Direction, { id: SpellId; label: string }> = {
  down: { id: "lumos", label: "Lumos!" },
  left: { id: "nox", label: "Nox!" },
  up: { id: "wingardium", label: "Wingardium Leviosa!" },
  right: { id: "expelliarmus", label: "Expelliarmus!" },
};

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

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

export default function WandGamePage() {
  const searchParams = useSearchParams();
  const backgroundId = searchParams.get("bg") ?? "1";
  const patronusId = searchParams.get("patronus") ?? "1";
  // Extension is resolved at runtime (see resolveImageUrl) so it doesn't
  // matter whether a dropped-in photo is .jpg, .jpeg, .png or .webp.
  const backgroundBasePath = `/backgrounds/${backgroundId}`;
  const patronusBasePath = `/patronus/${patronusId}`;

  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundImgRef = useRef<HTMLImageElement | null>(null);
  const detectorRef = useRef(new GestureDetector());
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const patronusRef = useRef(new PatronusEffect());
  const rafRef = useRef<number | null>(null);
  const tutorialStepRef = useRef<"pending" | "guide-down" | "done">("pending");
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
    let cancelled = false;
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let imageSegmenter: ImageSegmenter | null = null;
    const music = musicRef.current;

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
      setSpellText("Expecto Patronum!");
      if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
      spellTimeoutRef.current = setTimeout(() => setSpellText(null), 2500);
    }

    const patronusListener = startPatronusListener(triggerPatronus);

    let introInProgress = false;
    let praiseTimeout: ReturnType<typeof setTimeout> | null = null;

    // The ideal flow: ask the child's name, greet them, then walk them
    // through their very first spell (wave the wand down for Lumos) with a
    // spoken instruction and an on-screen arrow — only once that gesture is
    // actually detected does the guide go away and free play begins.
    async function runIntroTutorial() {
      if (introInProgress) return;
      introInProgress = true;
      tutorialStepRef.current = "pending";
      patronusListener.setPaused(true);
      try {
        setGreetingText("...");
        const vocative = await askForVocativeName(setGreetingText);
        if (cancelled) return;

        const name = vocative ?? "kouzelníku";
        const greeting = `Ahoj, ${name}!`;
        setGreetingText(greeting);
        await speak(greeting);
        if (cancelled) return;

        const instruction = "Teď zkus své první kouzlo! Máchni hůlkou dolů a řekni: Lumos!";
        setGreetingText(instruction);
        tutorialStepRef.current = "guide-down"; // shows the down-arrow guide
        await speak(instruction);
        // Text + arrow stay on screen until the down gesture actually lands.
      } finally {
        patronusListener.setPaused(false);
        introInProgress = false;
      }
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

    function triggerSpell(direction: Direction) {
      const spell = SPELLS[direction];
      playSpellSound(spell.id);
      setSpellText(spell.label);
      if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
      spellTimeoutRef.current = setTimeout(() => setSpellText(null), 1200);
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
          applyMaskAlpha(
            personCtx,
            personCanvas.width,
            personCanvas.height,
            mask.getAsFloat32Array(),
            mask.width,
            mask.height,
            INVERT_SEGMENTATION_MASK
          );
          mask.close();
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

          trailRef.current.push({ x: px, y: py, t: now });
          trailRef.current = trailRef.current.filter((p) => now - p.t < 500);

          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 4;
          ctx.beginPath();
          trailRef.current.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();

          ctx.fillStyle = "#facc15";
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.fill();

          const direction = detectorRef.current.addSample(tip.x, tip.y, now);
          if (direction) {
            triggerSpell(direction);
            // Lumos always flashes the scene brighter, tutorial or not —
            // it's the light spell, so every cast should light things up.
            if (direction === "down") {
              lumosGlowStartRef.current = now;
            }
            if (direction === "down" && tutorialStepRef.current === "guide-down") {
              tutorialStepRef.current = "done";
              setGreetingText(null);
              // Let the glow actually flash on screen for a moment before
              // the praise lands, so they don't overlap.
              praiseTimeout = setTimeout(() => {
                praiseTimeout = null;
                setSpellText("Skvělé!");
                if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
                spellTimeoutRef.current = setTimeout(() => setSpellText(null), 1500);
                speak("Skvělé!").catch(() => {});
              }, 600);
            }
          }
        }

        ctx.restore();

        // 4) The patron effect is a screen-space overlay, not mirrored with
        // the person, so it's drawn after restoring the mirror transform.
        patronusRef.current.update(now);
        patronusRef.current.render(ctx, now);

        // 5) First-spell guide arrow (screen-space, not mirrored) — a long,
        // thin directional arrow (shaft + arrowhead), not an emoji icon, so
        // it reads as a "swing this way" line rather than a static symbol.
        // Only shown while waiting for the tutorial's down-swipe.
        if (tutorialStepRef.current === "guide-down") {
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
    };
  }, [backgroundBasePath, patronusBasePath]);

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
        src="/music/background.mp3"
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
