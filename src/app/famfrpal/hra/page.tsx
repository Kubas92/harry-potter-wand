"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { GoldenSnitchEffect } from "@/lib/golden-snitch-effect";
import { playSpellSound } from "@/lib/spell-sounds";
import { silenceMediapipeInfoLogs } from "@/lib/silence-mediapipe-logs";
import { WASM_BASE, HAND_MODEL_URL } from "@/lib/mediapipe-assets";
import { speak } from "@/lib/voice-greeting";
import { resolveImageUrl } from "@/lib/resolve-asset";

// Where a dropped-in snitch image is expected — resolveImageUrl tries
// webp/jpg/jpeg/png, same convention as backgrounds/patronus/bubaci.
const SNITCH_IMAGE_BASE_PATH = "/famfrpal/zlatonka";

const DEFAULT_ROUND_DURATION_S = 60;
// Younger kids need the snitch to move slower — /famfrpal offers 4
// combinations (duration x speed) and passes both as query params, read
// below. `SLOW_SPEED_MULTIPLIER` scales GoldenSnitchEffect's own
// SPEED_FRACTION_PER_SEC; "fast" leaves it untouched (multiplier 1).
const SLOW_SPEED_MULTIPLIER = 0.45;
// "expert" — faster than "fast", and the snitch (re)spawns anywhere in the
// frame, away from the hand, instead of near the center — otherwise just
// holding a hand in the middle of the screen catches most respawns.
const EXPERT_SPEED_MULTIPLIER = 1.4;
// Expert also re-picks its direction twice as often (RETARGET_MS 400-900ms
// → 200-450ms), so it dodges more sharply.
const EXPERT_RETARGET_MULTIPLIER = 0.5;
const CATCH_RADIUS_FRACTION = 0.07; // fraction of canvas width — generous, this is for small kids
const CATCH_COOLDOWN_MS = 400; // guards a single catch from registering on more than one frame
const RESPAWN_DELAY_MS = 900; // brief gap after a catch before the next snitch appears
const COUNTDOWN_STEPS = ["3", "2", "1", "Chyť je!"] as const;
const COUNTDOWN_STEP_MS = 700;
// How long the final score stays on screen before going back to /famfrpal
// for the next kid.
const ROUND_COMPLETE_REDIRECT_MS = 5000;

type Status = "loading" | "ready" | "countdown" | "playing" | "finished" | "error";

const LOADING_MESSAGES: Record<string, string> = {
  camera: "Žádám o přístup ke kameře...",
  wasm: "Stahuji kouzelnou knihovnu...",
  hand: "Připravuji hřiště...",
};

function FamfrpalGamePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roundDurationMs = (Number(searchParams.get("duration")) || DEFAULT_ROUND_DURATION_S) * 1000;
  const speed = searchParams.get("speed");
  const isExpert = speed === "expert";
  const speedMultiplier = speed === "slow" ? SLOW_SPEED_MULTIPLIER : isExpert ? EXPERT_SPEED_MULTIPLIER : 1;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snitchRef = useRef(new GoldenSnitchEffect());
  const rafRef = useRef<number | null>(null);
  // Logic lives in refs (read inside the per-frame loop() closure, which
  // would otherwise see stale values of React state — same pattern used
  // throughout kouzla/hra and bubaci/hra); the matching useState below is
  // only for what's actually displayed.
  const scoreRef = useRef(0);
  const roundEndAtRef = useRef<number | null>(null);
  const lastCatchAtRef = useRef(0);
  const roundEndHandledRef = useRef(false);
  const respawnAtRef = useRef<number | null>(null);
  // Last tracked palm position (raw pixel space) — expert mode spawns the
  // snitch away from it.
  const lastPalmRef = useRef<{ x: number; y: number } | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [loadingStep, setLoadingStep] = useState<keyof typeof LOADING_MESSAGES>("camera");
  const [errorMsg, setErrorMsg] = useState("");
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);

  useEffect(() => {
    silenceMediapipeInfoLogs();
    let cancelled = false;
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let redirectTimeout: ReturnType<typeof setTimeout> | null = null;

    // See kouzla/hra for why this pattern matters: React Strict Mode mounts
    // effects twice in dev, and a slow-resolving getUserMedia/model-load
    // that finishes after the first mount's cleanup already ran would
    // otherwise leak a live camera stream / GPU-backed ML model forever.
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
    function releaseAll() {
      releaseStream();
      releaseHandLandmarker();
      if (timerInterval) clearInterval(timerInterval);
      if (redirectTimeout) clearTimeout(redirectTimeout);
    }

    snitchRef.current.setSpeedMultiplier(speedMultiplier);
    snitchRef.current.setSpawnAnywhere(isExpert);
    snitchRef.current.setRetargetMultiplier(isExpert ? EXPERT_RETARGET_MULTIPLIER : 1);
    resolveImageUrl(SNITCH_IMAGE_BASE_PATH)
      .then((url) => snitchRef.current.loadShape(url))
      .catch((err) => console.warn("[famfrpal] no snitch image found yet:", err));

    // Speaks the kickoff line, runs a short 3-2-1 countdown for drama, then
    // spawns the snitch and starts the round. No name-asking here (unlike
    // kouzla/hra) — this is meant to be a quick, repeatable activity for a
    // line of kids, not a one-on-one tutorial. Deliberately says "čas"
    // rather than a specific duration, since /famfrpal now offers both a
    // 30s and a 60s mode and the spoken line shouldn't need a branch per
    // duration.
    async function startRound() {
      await speak("Trénink famfrpálu! Chyť co nejvíc zlatonek, než vyprší čas!");
      if (cancelled) return;

      setStatus("countdown");
      for (const label of COUNTDOWN_STEPS) {
        if (cancelled) return;
        setCountdownText(label);
        await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_STEP_MS));
      }
      if (cancelled) return;
      setCountdownText(null);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const now = performance.now();
      scoreRef.current = 0;
      setScore(0);
      roundEndHandledRef.current = false;
      respawnAtRef.current = null;
      snitchRef.current.spawn(canvas.width, canvas.height, now, lastPalmRef.current);
      roundEndAtRef.current = now + roundDurationMs;
      setTimeLeftSeconds(roundDurationMs / 1000);
      setStatus("playing");

      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (roundEndAtRef.current === null) return;
        const remaining = Math.max(0, Math.ceil((roundEndAtRef.current - performance.now()) / 1000));
        setTimeLeftSeconds(remaining);
      }, 250);
    }

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          releaseStream();
          return;
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        if (cancelled) {
          releaseStream();
          return;
        }
        setLoadingStep("wasm");
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

        if (cancelled) {
          releaseStream();
          return;
        }
        setLoadingStep("hand");
        try {
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        } catch {
          handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        }

        if (cancelled) {
          releaseAll();
          return;
        }
        setStatus("ready");
        loop();
        startRound();
      } catch (err) {
        console.error("[famfrpal] init failed:", err);
        if (cancelled) {
          releaseAll();
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !handLandmarker) return;

      const ctx = canvas.getContext("2d")!;

      if (video.readyState >= 2) {
        const now = performance.now();
        const roundActive = roundEndAtRef.current !== null && now < roundEndAtRef.current;

        // Everything (video, snitch, catch ring) is mirrored together — a
        // natural "look in a mirror" self-view, same simplification
        // bubaci/hra uses (no separate background layer to keep unmirrored).
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (roundActive) {
          if (respawnAtRef.current !== null && now >= respawnAtRef.current) {
            respawnAtRef.current = null;
            snitchRef.current.spawn(canvas.width, canvas.height, now, lastPalmRef.current);
          }
          snitchRef.current.update(canvas.width, canvas.height, now);
        }

        const handResult = handLandmarker.detectForVideo(video, now);
        const hand = handResult.landmarks[0];

        if (hand) {
          const palm = hand[9]; // middle finger MCP — a stable "center of hand" point
          const px = palm.x * canvas.width;
          const py = palm.y * canvas.height;
          const catchRadius = canvas.width * CATCH_RADIUS_FRACTION;
          lastPalmRef.current = { x: px, y: py };

          // A soft glowing ring at the catch point, so kids can see exactly
          // where they need to be — shown any time a hand is tracked, not
          // just mid-round.
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 4;
          ctx.shadowColor = "#facc15";
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(px, py, catchRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          if (
            roundActive &&
            snitchRef.current.isActive() &&
            now - lastCatchAtRef.current > CATCH_COOLDOWN_MS
          ) {
            const snitchPos = snitchRef.current.getPosition();
            const dist = Math.hypot(snitchPos.x - px, snitchPos.y - py);
            if (dist < catchRadius) {
              lastCatchAtRef.current = now;
              scoreRef.current += 1;
              setScore(scoreRef.current);
              playSpellSound("catch");
              snitchRef.current.deactivate();
              respawnAtRef.current = now + RESPAWN_DELAY_MS;
            }
          }
        }

        if (roundActive) {
          snitchRef.current.render(ctx, canvas.width, now);
        }

        ctx.restore();

        if (
          !roundActive &&
          roundEndAtRef.current !== null &&
          now >= roundEndAtRef.current &&
          !roundEndHandledRef.current
        ) {
          roundEndHandledRef.current = true;
          playSpellSound("fanfare");
          setFinalMessage(`Trénink dokončen! Chytil jsi ${scoreRef.current} zlatonek! 🏆`);
          setStatus("finished");
          redirectTimeout = setTimeout(() => {
            if (!cancelled) router.push("/famfrpal");
          }, ROUND_COMPLETE_REDIRECT_MS);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      releaseAll();
      window.speechSynthesis?.cancel();
    };
  }, [roundDurationMs, speedMultiplier, isExpert, router]);

  function toggleFullscreen() {
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {status === "loading" && (
        <p className="absolute text-white text-xl text-center px-6">{LOADING_MESSAGES[loadingStep]}</p>
      )}
      {status === "error" && (
        <p className="absolute text-red-400 text-center px-6">Chyba přístupu ke kameře: {errorMsg}</p>
      )}

      {countdownText && (
        <p className="absolute text-8xl font-bold text-yellow-300 drop-shadow-lg animate-pulse">
          {countdownText}
        </p>
      )}

      {status === "playing" && (
        <>
          <p className="absolute top-6 left-6 text-3xl font-bold text-yellow-300 drop-shadow-lg">🏆 {score}</p>
          <p className="absolute top-6 right-6 text-3xl font-bold text-white drop-shadow-lg">
            ⏱ {timeLeftSeconds ?? Math.round(roundDurationMs / 1000)}
          </p>
        </>
      )}

      {finalMessage && (
        <p className="absolute text-4xl font-bold text-yellow-300 drop-shadow-lg text-center px-6 max-w-xl">
          {finalMessage}
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
export default function FamfrpalGamePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <FamfrpalGamePageInner />
    </Suspense>
  );
}
