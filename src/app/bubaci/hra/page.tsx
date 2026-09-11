"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HandLandmarker, FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { CircleGestureDetector } from "@/lib/circle-gesture-detector";
import { SpiderEffect } from "@/lib/spider-effect";
import { playSpellSound } from "@/lib/spell-sounds";
import { askForVocativeName, speak } from "@/lib/voice-greeting";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const RESPAWN_DELAY_MS = 700;

type Status = "loading" | "ready" | "error";

const LOADING_MESSAGES: Record<string, string> = {
  camera: "Žádám o přístup ke kameře...",
  wasm: "Stahuji kouzelnou knihovnu...",
  hand: "Připravuji hůlku...",
  face: "Hledám obličej...",
};

export default function BubaciGamePage() {
  const searchParams = useSearchParams();
  const bubakType = searchParams.get("bubak") ?? "spiders";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const circleDetectorRef = useRef(new CircleGestureDetector());
  const spiderRef = useRef<SpiderEffect | null>(null);
  const nextSpawnAtRef = useRef<number | null>(null);
  const introDoneRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [loadingStep, setLoadingStep] = useState<keyof typeof LOADING_MESSAGES>("camera");
  const [errorMsg, setErrorMsg] = useState("");
  const [introText, setIntroText] = useState<string | null>(null);
  const [banishText, setBanishText] = useState<string | null>(null);
  const banishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let faceLandmarker: FaceLandmarker | null = null;

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
    function releaseFaceLandmarker() {
      if (faceLandmarker) {
        faceLandmarker.close();
        faceLandmarker = null;
      }
    }
    function releaseAll() {
      releaseStream();
      releaseHandLandmarker();
      releaseFaceLandmarker();
    }

    async function runIntro() {
      const vocative = await askForVocativeName(setIntroText);
      if (cancelled) return;
      const name = vocative ?? "kouzelníku";
      const instruction = `${name}, musíš zahnat pavouky! Mávni hůlkou do kruhu a odeženeš pavouka.`;
      setIntroText(instruction);
      await speak(instruction);
      if (cancelled) return;
      setIntroText(null);
      spiderRef.current = new SpiderEffect();
      introDoneRef.current = true;
    }

    async function init() {
      try {
        console.log("[bubaci] requesting getUserMedia...");
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
        setLoadingStep("face");
        try {
          faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 1,
          });
        } catch {
          faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numFaces: 1,
          });
        }

        if (cancelled) {
          releaseAll();
          return;
        }
        setStatus("ready");
        loop();
        runIntro();
      } catch (err) {
        console.error("[bubaci] init failed:", err);
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
      if (!video || !canvas || !handLandmarker || !faceLandmarker) return;

      const ctx = canvas.getContext("2d")!;

      if (video.readyState >= 2) {
        const now = performance.now();

        // Everything (video, spider, trail) is mirrored together — a
        // natural "look in a mirror" self-view, no separate background
        // layer to keep unmirrored like in kouzla/hra.
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const faceResult = faceLandmarker.detectForVideo(video, now);
        const face = faceResult.faceLandmarks[0];

        if (introDoneRef.current) {
          if (spiderRef.current) {
            spiderRef.current.render(ctx, face, canvas.width, canvas.height, now);
            if (spiderRef.current.isDone()) {
              spiderRef.current = null;
              nextSpawnAtRef.current = now + RESPAWN_DELAY_MS;
            }
          } else if (nextSpawnAtRef.current !== null && now >= nextSpawnAtRef.current) {
            spiderRef.current = new SpiderEffect();
            nextSpawnAtRef.current = null;
          }
        }

        const handResult = handLandmarker.detectForVideo(video, now);
        const hand = handResult.landmarks[0];

        if (hand) {
          const tip = hand[8]; // index fingertip
          const px = tip.x * canvas.width;
          const py = tip.y * canvas.height;

          trailRef.current.push({ x: px, y: py, t: now });
          trailRef.current = trailRef.current.filter((p) => now - p.t < 800);

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

          const circleDrawn = circleDetectorRef.current.addSample(tip.x, tip.y, now);
          if (circleDrawn && introDoneRef.current && spiderRef.current) {
            spiderRef.current.banish();
            playSpellSound("banish");
            setBanishText("Bubák zahnán! 🎉");
            if (banishTimeoutRef.current) clearTimeout(banishTimeoutRef.current);
            banishTimeoutRef.current = setTimeout(() => setBanishText(null), 1500);
          }
        }

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      releaseAll();
      window.speechSynthesis?.cancel();
      if (banishTimeoutRef.current) clearTimeout(banishTimeoutRef.current);
    };
  }, [bubakType]);

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

      {introText && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 text-3xl font-semibold text-blue-200 drop-shadow-lg text-center px-6 max-w-xl">
          {introText}
        </p>
      )}

      {banishText && (
        <p className="absolute top-10 left-1/2 -translate-x-1/2 text-4xl font-bold text-yellow-300 drop-shadow-lg animate-pulse">
          {banishText}
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
