"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HandLandmarker, FaceLandmarker, ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";
import { CircleGestureDetector } from "@/lib/circle-gesture-detector";
import { WandTrailEffect } from "@/lib/wand-trail";
import { SpiderEffect } from "@/lib/spider-effect";
import { DementorEffect } from "@/lib/dementor-effect";
import { SnakeEffect } from "@/lib/snake-effect";
import { applyMaskAlpha, computeMaskBounds, NormalizedBounds } from "@/lib/background-composite";
import { playSpellSound } from "@/lib/spell-sounds";
import { silenceMediapipeInfoLogs } from "@/lib/silence-mediapipe-logs";
import { WASM_BASE, HAND_MODEL_URL, FACE_MODEL_URL, SEGMENTER_MODEL_URL } from "@/lib/mediapipe-assets";
import { askForVocativeName, speak } from "@/lib/voice-greeting";
import { resolveImageUrl } from "@/lib/resolve-asset";
import { asset } from "@/lib/web-build";
import { newPhotoSession, uploadCanvasPhoto } from "@/lib/photo-upload";


// Same convention as kouzla/hra: flip if the mask ever comes back inverted.
const INVERT_SEGMENTATION_MASK = false;
const PERSON_MASK_THRESHOLD = 0.5;
// Where dropped-in boggart images are expected — resolveImageUrl tries
// webp/jpg/jpeg/png, same convention as backgrounds/ and patronus/.
const DEMENTOR_IMAGE_BASE_PATH = "/bubaci/mozkomor";
const SNAKE_IMAGE_BASE_PATH = "/bubaci/had";

const RESPAWN_DELAY_MS = 700;

// A round ends after this many successful banishes — otherwise a single kid
// could keep going indefinitely, and the owner wants the game to cycle back
// to the menu on its own so the next kid can start fresh.
const BANISH_LIMIT = 5;
// How long the "Výborně!" completion message stays on screen (and is spoken)
// before auto-navigating back to the menu.
const ROUND_COMPLETE_REDIRECT_MS = 2000;

// Reaction photos: every time a boggart appears, save a short burst of
// canvas snapshots (camera + boggart, as seen on the TV) via /api/photos
// into photos/bubaci/<session>/ — one session folder per page load, i.e.
// per kid. Delays are ms after the appearance; spiders/dementors fade/crawl
// in, so their burst starts a bit later than the snake's (which is already
// at full size when "holding" begins).
const PHOTO_DELAYS_MS = [300, 900, 1500] as const;
const SNAKE_PHOTO_DELAYS_MS = [0, 300, 600] as const;
// On screen the striking snake covers the kid's face, so snake strikes also
// save a "portrait" composite: camera → smaller snake peeking over the
// kid's shoulder → segmented kid cut out on top, so the snake is *behind*
// them. Offset/size are fractions of canvas width, relative to the face
// (nose tip); the snake goes to whichever side has more room.
const SNAKE_PORTRAIT_OFFSET_X = 0.2;
const SNAKE_PORTRAIT_OFFSET_Y = -0.08;
const SNAKE_PORTRAIT_WIDTH_FRACTION = 0.5;

// Background music — same track as kouzla/hra (public/music/background.mp3),
// but a different, louder, more tense segment (2:30-3:40) looped instead of
// the calmer opening used there, and at a higher volume ("ať je to
// dramatické" — this is the scary-boggart game, not the gentle spell one).
const BUBACI_MUSIC_START_SECONDS = 2 * 60 + 30; // 2:30
const BUBACI_MUSIC_END_SECONDS = 3 * 60 + 40; // 3:40
const BUBACI_MUSIC_VOLUME = 0.4;

// Kids hold a real wand that extends past their index fingertip, so anchoring
// the dot/trail directly to the hand[8] landmark makes it visibly lag behind
// where the wand's actual tip is. Extrapolate along the wrist->fingertip
// direction (a longer, steadier baseline than using only fingertip-area
// landmarks, so ordinary hand-tracking jitter isn't amplified as much) by a
// fraction of that vector's own length. Unlike the wand-visibility band tried
// (and reverted) in kouzla/hra, this involves no segmentation mask — this
// game already draws the full raw camera feed, so it's a pure position
// estimate with no risk of exposing unprocessed background.
const WAND_TIP_EXTENSION = 0.7; // fraction of wrist->fingertip length, added past the tip

function estimateWandTip(hand: { x: number; y: number }[]): { x: number; y: number } {
  const wrist = hand[0];
  const fingertip = hand[8];
  const dx = fingertip.x - wrist.x;
  const dy = fingertip.y - wrist.y;
  return {
    x: fingertip.x + dx * WAND_TIP_EXTENSION,
    y: fingertip.y + dy * WAND_TIP_EXTENSION,
  };
}

type Status = "loading" | "ready" | "error";

const LOADING_MESSAGES: Record<string, string> = {
  camera: "Žádám o přístup ke kameře...",
  wasm: "Stahuji kouzelnou knihovnu...",
  hand: "Připravuji hůlku...",
  face: "Hledám obličej...",
  segmenter: "Připravuji mozkomora...",
};

function BubaciGamePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bubakType = searchParams.get("bubak") ?? "spiders";
  const isDementor = bubakType === "dementor";
  const isSnake = bubakType === "snake";

  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailEffectRef = useRef(new WandTrailEffect(800));
  const circleDetectorRef = useRef(new CircleGestureDetector());
  const spiderRef = useRef<SpiderEffect | null>(null);
  const dementorRef = useRef(new DementorEffect());
  const dementorActiveRef = useRef(false);
  const snakeRef = useRef(new SnakeEffect());
  const snakeActiveRef = useRef(false);
  const nextSpawnAtRef = useRef<number | null>(null);
  const introDoneRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const banishCountRef = useRef(0);
  const lastSnakeStrikeCountRef = useRef(0);
  const lastFaceRef = useRef<{ x: number; y: number } | null>(null);
  const roundCompleteRef = useRef(false);

  const [status, setStatus] = useState<Status>("loading");
  const [loadingStep, setLoadingStep] = useState<keyof typeof LOADING_MESSAGES>("camera");
  const [errorMsg, setErrorMsg] = useState("");
  const [introText, setIntroText] = useState<string | null>(null);
  const [banishText, setBanishText] = useState<string | null>(null);
  const banishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = BUBACI_MUSIC_VOLUME;
  }, []);

  useEffect(() => {
    // Best-effort — works if the browser already considers this page
    // "engaged". If not, the click-to-fullscreen handler below is the
    // guaranteed fallback (same pattern as kouzla/hra).
    if (status === "ready") musicRef.current?.play().catch(() => {});
  }, [status]);

  useEffect(() => {
    silenceMediapipeInfoLogs();
    let cancelled = false;
    const photoTimeouts = new Set<ReturnType<typeof setTimeout>>();
    const photoSession = newPhotoSession(bubakType);

    // Builds the snake "portrait" off-screen (never shown on the TV) — see
    // SNAKE_PORTRAIT_* above. The segmenter only runs here, a few times per
    // strike, not every frame, so the snake game's per-frame cost is
    // unchanged.
    function captureSnakePortrait(label: string) {
      const video = videoRef.current;
      if (!video || !imageSegmenter || cancelled || video.readyState < 2) return;
      const w = video.videoWidth;
      const h = video.videoHeight;

      const person = document.createElement("canvas");
      person.width = w;
      person.height = h;
      const personCtx = person.getContext("2d", { willReadFrequently: true })!;
      personCtx.drawImage(video, 0, 0, w, h);
      const mask = imageSegmenter.segmentForVideo(video, performance.now()).confidenceMasks?.[0];
      if (!mask) return;
      applyMaskAlpha(personCtx, w, h, mask.getAsFloat32Array(), mask.width, mask.height, INVERT_SEGMENTATION_MASK);
      mask.close();

      const photo = document.createElement("canvas");
      photo.width = w;
      photo.height = h;
      const ctx = photo.getContext("2d")!;
      // Same mirrored space as the game view, so the photo matches the TV.
      ctx.scale(-1, 1);
      ctx.translate(-w, 0);
      ctx.drawImage(video, 0, 0, w, h);
      const face = lastFaceRef.current ?? { x: 0.5, y: 0.4 };
      const side = face.x < 0.5 ? 1 : -1;
      const drawn = snakeRef.current.drawPortrait(
        ctx,
        (face.x + side * SNAKE_PORTRAIT_OFFSET_X) * w,
        face.y * h + SNAKE_PORTRAIT_OFFSET_Y * w,
        w * SNAKE_PORTRAIT_WIDTH_FRACTION
      );
      if (!drawn) return;
      ctx.drawImage(person, 0, 0);
      uploadCanvasPhoto("bubaci", photoSession, label, photo);
    }

    function capturePhoto(label: string) {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      uploadCanvasPhoto("bubaci", photoSession, label, canvas);
    }

    function capturePhotoBurst(delays: readonly number[]) {
      delays.forEach((delay, i) => {
        const t = setTimeout(() => {
          photoTimeouts.delete(t);
          capturePhoto(`${bubakType}-${i + 1}`);
          if (isSnake) captureSnakePortrait(`${bubakType}-portrait-${i + 1}`);
        }, delay);
        photoTimeouts.add(t);
      });
    }
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;
    let faceLandmarker: FaceLandmarker | null = null;
    let imageSegmenter: ImageSegmenter | null = null;
    const music = musicRef.current;

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
    function releaseImageSegmenter() {
      if (imageSegmenter) {
        imageSegmenter.close();
        imageSegmenter = null;
      }
    }
    function releaseAll() {
      releaseStream();
      releaseHandLandmarker();
      releaseFaceLandmarker();
      releaseImageSegmenter();
    }

    if (isDementor) {
      resolveImageUrl(DEMENTOR_IMAGE_BASE_PATH)
        .then((url) => dementorRef.current.loadShape(url))
        .catch((err) => console.warn("[bubaci] no dementor image found yet:", err));
    }
    if (isSnake) {
      resolveImageUrl(SNAKE_IMAGE_BASE_PATH)
        .then((url) => snakeRef.current.loadShape(url))
        .catch((err) => console.warn("[bubaci] no snake image found yet:", err));
    }

    async function runIntro() {
      const vocative = await askForVocativeName(setIntroText);
      if (cancelled) return;
      const name = vocative ?? "kouzelníku";
      const instruction = isDementor
        ? `${name}, musíš zahnat bubáky! Mávni hůlkou do kruhu a odeženeš bubáka.`
        : isSnake
          ? `${name}, musíš zahnat hady! Mávni hůlkou do kruhu a odeženeš hada.`
          : `${name}, musíš zahnat pavouky! Mávni hůlkou do kruhu a odeženeš pavouka.`;
      setIntroText(instruction);
      await speak(instruction);
      if (cancelled) return;
      setIntroText(null);
      if (isDementor) {
        dementorRef.current.spawn();
        dementorActiveRef.current = true;
      } else if (isSnake) {
        snakeRef.current.spawn();
        snakeActiveRef.current = true;
      } else {
        spiderRef.current = new SpiderEffect();
      }
      introDoneRef.current = true;
    }

    async function completeRound() {
      playSpellSound("fanfare");
      const congrats = isDementor
        ? "Výborně, zahnal jsi bubáky!"
        : isSnake
          ? "Výborně, zahnal jsi hady!"
          : "Výborně, zahnal jsi pavouky!";
      setIntroText(congrats);
      await speak(congrats);
      if (cancelled) return;
      redirectTimeoutRef.current = setTimeout(() => {
        if (!cancelled) router.push("/");
      }, ROUND_COMPLETE_REDIRECT_MS);
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

        if (isDementor) {
          const personCanvas = document.createElement("canvas");
          personCanvas.width = video.videoWidth;
          personCanvas.height = video.videoHeight;
          personCanvasRef.current = personCanvas;
        }

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
        if (isDementor) {
          setLoadingStep("segmenter");
          try {
            imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
              baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "GPU" },
              runningMode: "VIDEO",
              outputCategoryMask: false,
              outputConfidenceMasks: true,
            });
          } catch {
            imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
              baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "CPU" },
              runningMode: "VIDEO",
              outputCategoryMask: false,
              outputConfidenceMasks: true,
            });
          }
        } else {
          // Both spiders and snake use FaceLandmarker — spiders to crawl
          // between face anchors, snake to aim its strike at wherever the
          // child's face currently is.
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
          if (isSnake) {
            // Photo-only (see captureSnakePortrait) — not run per frame.
            if (cancelled) {
              releaseAll();
              return;
            }
            setLoadingStep("segmenter");
            try {
              imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "GPU" },
                runningMode: "VIDEO",
                outputCategoryMask: false,
                outputConfidenceMasks: true,
              });
            } catch {
              imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "CPU" },
                runningMode: "VIDEO",
                outputCategoryMask: false,
                outputConfidenceMasks: true,
              });
            }
          }
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
      const personCanvas = personCanvasRef.current;
      if (!video || !canvas || !handLandmarker) return;
      if (isDementor) {
        if (!personCanvas || !imageSegmenter) return;
      } else if (!faceLandmarker) {
        return;
      }

      const ctx = canvas.getContext("2d")!;

      if (video.readyState >= 2) {
        const now = performance.now();

        // Everything (video, boggart, trail) is mirrored together — a
        // natural "look in a mirror" self-view, no separate background
        // layer to keep unmirrored like in kouzla/hra.
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (isDementor && personCanvas && imageSegmenter) {
          // Cut the person out of a separate raw (unmirrored) draw of the
          // same frame, same technique kouzla/hra uses for its background
          // swap — except here the "background" is the live feed itself, so
          // the dementor just needs to be drawn between the two: behind the
          // person cutout, in front of the raw frame.
          const personCtx = personCanvas.getContext("2d", { willReadFrequently: true })!;
          personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
          const segResult = imageSegmenter.segmentForVideo(video, now);
          const mask = segResult.confidenceMasks?.[0];
          let personBounds: NormalizedBounds | null = null;
          if (mask) {
            const maskData = mask.getAsFloat32Array();
            personBounds = computeMaskBounds(
              maskData,
              mask.width,
              mask.height,
              PERSON_MASK_THRESHOLD,
              INVERT_SEGMENTATION_MASK
            );
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
          }

          if (introDoneRef.current) {
            if (dementorActiveRef.current) {
              dementorRef.current.render(ctx, canvas.width, canvas.height, now, personBounds);
              if (dementorRef.current.isDone()) {
                dementorActiveRef.current = false;
                if (banishCountRef.current >= BANISH_LIMIT) {
                  roundCompleteRef.current = true;
                  completeRound();
                } else {
                  nextSpawnAtRef.current = now + RESPAWN_DELAY_MS;
                }
              }
            } else if (!roundCompleteRef.current && nextSpawnAtRef.current !== null && now >= nextSpawnAtRef.current) {
              dementorRef.current.spawn();
              dementorActiveRef.current = true;
              nextSpawnAtRef.current = null;
              capturePhotoBurst(PHOTO_DELAYS_MS);
            }
          }

          ctx.drawImage(personCanvas, 0, 0);
        } else if (isSnake && faceLandmarker) {
          const faceResult = faceLandmarker.detectForVideo(video, now);
          const face = faceResult.faceLandmarks[0];
          // Landmark 1 = nose tip (same indexing spiders' FACE_ANCHOR_INDICES
          // uses) — aim the strike at the child's actual face, not a fixed
          // screen point.
          const faceTarget = face ? { x: face[1].x, y: face[1].y } : null;
          if (faceTarget) lastFaceRef.current = faceTarget;

          if (introDoneRef.current) {
            if (snakeActiveRef.current) {
              snakeRef.current.render(ctx, canvas.width, canvas.height, now, faceTarget);
              // The snake is invisible until it strikes (possibly several
              // times per spawn) — photograph each strike, not the spawn.
              const strikes = snakeRef.current.getStrikeCount();
              if (strikes > lastSnakeStrikeCountRef.current) {
                lastSnakeStrikeCountRef.current = strikes;
                capturePhotoBurst(SNAKE_PHOTO_DELAYS_MS);
              }
              if (snakeRef.current.isDone()) {
                snakeActiveRef.current = false;
                if (banishCountRef.current >= BANISH_LIMIT) {
                  roundCompleteRef.current = true;
                  completeRound();
                } else {
                  nextSpawnAtRef.current = now + RESPAWN_DELAY_MS;
                }
              }
            } else if (!roundCompleteRef.current && nextSpawnAtRef.current !== null && now >= nextSpawnAtRef.current) {
              snakeRef.current.spawn();
              snakeActiveRef.current = true;
              nextSpawnAtRef.current = null;
            }
          }
        } else if (faceLandmarker) {
          const faceResult = faceLandmarker.detectForVideo(video, now);
          const face = faceResult.faceLandmarks[0];

          if (introDoneRef.current) {
            if (spiderRef.current) {
              spiderRef.current.render(ctx, face, canvas.width, canvas.height, now);
              if (spiderRef.current.isDone()) {
                spiderRef.current = null;
                if (banishCountRef.current >= BANISH_LIMIT) {
                  roundCompleteRef.current = true;
                  completeRound();
                } else {
                  nextSpawnAtRef.current = now + RESPAWN_DELAY_MS;
                }
              }
            } else if (!roundCompleteRef.current && nextSpawnAtRef.current !== null && now >= nextSpawnAtRef.current) {
              spiderRef.current = new SpiderEffect();
              nextSpawnAtRef.current = null;
              capturePhotoBurst(PHOTO_DELAYS_MS);
            }
          }
        }

        const handResult = handLandmarker.detectForVideo(video, now);
        const hand = handResult.landmarks[0];

        if (hand) {
          const tip = estimateWandTip(hand);
          const px = tip.x * canvas.width;
          const py = tip.y * canvas.height;

          trailEffectRef.current.addPoint(px, py, now);
          trailEffectRef.current.render(ctx, now);

          const circleDrawn = circleDetectorRef.current.addSample(tip.x, tip.y, now);
          if (circleDrawn && introDoneRef.current) {
            let banished = false;
            if (isDementor) {
              if (dementorActiveRef.current) {
                dementorRef.current.banish();
                banished = true;
              }
            } else if (isSnake) {
              if (snakeActiveRef.current) {
                snakeRef.current.banish();
                banished = true;
              }
            } else if (spiderRef.current) {
              spiderRef.current.banish();
              banished = true;
            }
            if (banished) {
              banishCountRef.current += 1;
              playSpellSound("banish");
              setBanishText("Bubák zahnán! 🎉");
              if (banishTimeoutRef.current) clearTimeout(banishTimeoutRef.current);
              banishTimeoutRef.current = setTimeout(() => setBanishText(null), 1500);
            }
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
      music?.pause();
      if (banishTimeoutRef.current) clearTimeout(banishTimeoutRef.current);
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current);
      photoTimeouts.forEach(clearTimeout);
    };
  }, [bubakType, isDementor, isSnake, router]);

  function toggleFullscreen() {
    // Browsers block audio autoplay until a real user gesture — this click
    // handler already exists for fullscreen, so it doubles as the reliable
    // way to start the background music too (same pattern as kouzla/hra).
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
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = BUBACI_MUSIC_START_SECONDS;
        }}
        onTimeUpdate={(e) => {
          // Loop just the 2:30-3:40 stretch of the track instead of the
          // whole file — no need to actually trim/re-export the mp3.
          if (e.currentTarget.currentTime >= BUBACI_MUSIC_END_SECONDS) {
            e.currentTarget.currentTime = BUBACI_MUSIC_START_SECONDS;
          }
        }}
      />
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

// useSearchParams() needs a Suspense boundary for `next build` (production
// mode) — the page itself is fully client-side, so the fallback is just
// the same black screen it starts on anyway.
export default function BubaciGamePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <BubaciGamePageInner />
    </Suspense>
  );
}
