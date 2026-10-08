"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FaceLandmarker, FilesetResolver, HandLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import { FACE_MODEL_URL, HAND_MODEL_URL, SEGMENTER_MODEL_URL, WASM_BASE } from "@/lib/mediapipe-assets";
import { resolveImageUrl } from "@/lib/resolve-asset";
import { asset } from "@/lib/web-build";
import { listenOnce, speak } from "@/lib/voice-greeting";
import { silenceMediapipeInfoLogs } from "@/lib/silence-mediapipe-logs";

// Pre-flight checklist to run on-site before the kids arrive: everything
// the games depend on, checked in one place. Automatic checks run on load;
// mic/voice/lamp need a human (you have to speak / listen / look at the
// lamp), so those are buttons.
type State = "pending" | "ok" | "warn" | "fail";
type Check = { state: State; detail: string };

const ICON: Record<State, string> = { pending: "⏳", ok: "✅", warn: "⚠️", fail: "❌" };

const AUTO_CHECKS = [
  { id: "internet", label: "Internet (potřeba jen pro rozpoznávání řeči)" },
  { id: "camera", label: "Kamera" },
  { id: "models", label: "ML modely (lokálně, bez internetu)" },
  { id: "images", label: "Obrázky (pozadí, patroni, bubáci, zlatonka)" },
  { id: "music", label: "Hudba" },
  { id: "photos", label: "Ukládání fotek" },
  { id: "voice", label: "Český hlas v Macu (offline)" },
] as const;

type AutoId = (typeof AUTO_CHECKS)[number]["id"];

const IMAGE_PATHS = [
  "/backgrounds/1",
  "/backgrounds/2",
  "/backgrounds/3",
  "/patronus/1",
  "/patronus/2",
  "/patronus/fox",
  "/patronus/horse",
  "/bubaci/mozkomor",
  "/bubaci/had",
  "/famfrpal/zlatonka",
];

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

export default function KontrolaPage() {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [manual, setManual] = useState<Record<string, Check>>({});
  const videoRef = useRef<HTMLVideoElement>(null);

  function set(id: string, state: State, detail: string) {
    setChecks((c) => ({ ...c, [id]: { state, detail } }));
  }
  function setM(id: string, state: State, detail: string) {
    setManual((c) => ({ ...c, [id]: { state, detail } }));
  }

  useEffect(() => {
    silenceMediapipeInfoLogs();
    let cancelled = false;
    let stream: MediaStream | null = null;
    const update = (id: AutoId, state: State, detail: string) => {
      if (!cancelled) set(id, state, detail);
    };

    // Internet — no-cors fetch just proves something answered.
    withTimeout(fetch("https://www.google.com/generate_204", { mode: "no-cors", cache: "no-store" }), 4000)
      .then(() => update("internet", "ok", "Připojeno"))
      .catch(() =>
        update(
          "internet",
          "warn",
          "Bez internetu — hry poběží, ale nepůjde zjišťování jména ani hlasový Patronus (Chrome rozpoznává řeč online). Zapni hotspot z telefonu."
        )
      );

    // Camera — the games ask for the same constraints.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => {});
        }
        const track = s.getVideoTracks()[0];
        const { width, height } = track.getSettings();
        update("camera", "ok", `${track.label || "kamera"} — ${width}×${height}`);
      })
      .catch((err) => update("camera", "fail", String(err)));

    // Models — actually load each one from the local files (proves the
    // offline setup works end to end), then dispose it straight away.
    (async () => {
      try {
        const missing: string[] = [];
        for (const url of [HAND_MODEL_URL, FACE_MODEL_URL, SEGMENTER_MODEL_URL, `${WASM_BASE}/vision_wasm_internal.wasm`]) {
          const res = await fetch(url, { method: "HEAD" });
          if (!res.ok) missing.push(url);
        }
        if (missing.length > 0) {
          update("models", "fail", `Chybí: ${missing.join(", ")} — spusť „npm run fetch-assets“`);
          return;
        }
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const hand = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
          runningMode: "VIDEO",
        });
        hand.close();
        const face = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
          runningMode: "VIDEO",
        });
        face.close();
        const seg = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: "CPU" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
        });
        seg.close();
        update("models", "ok", "Ruka, obličej i vyříznutí postavy se načetly z disku");
      } catch (err) {
        update("models", "fail", String(err));
      }
    })();

    Promise.allSettled(IMAGE_PATHS.map((p) => resolveImageUrl(p))).then((results) => {
      const missing = IMAGE_PATHS.filter((_, i) => results[i].status === "rejected");
      if (missing.length === 0) update("images", "ok", `Všech ${IMAGE_PATHS.length} obrázků je na místě`);
      else update("images", "fail", `Chybí: ${missing.join(", ")}`);
    });

    fetch(asset("/music/background.mp3"), { method: "HEAD" })
      .then((res) => update("music", res.ok ? "ok" : "fail", res.ok ? "background.mp3 nalezen" : `HTTP ${res.status}`))
      .catch((err) => update("music", "fail", String(err)));

    fetch("/api/photos", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { sessions: { photos: string[] }[] }) => {
        const total = data.sessions.reduce((n, s) => n + s.photos.length, 0);
        update("photos", "ok", `Funguje — zatím ${total} fotek v ${data.sessions.length} složkách`);
      })
      .catch((err) => update("photos", "fail", String(err)));

    const checkVoices = () => {
      const cs = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("cs"));
      const local = cs.find((v) => v.localService);
      if (local) update("voice", "ok", local.name);
      else if (cs.length > 0) update("voice", "warn", `Jen online hlas (${cs[0].name}) — bez internetu nebude mluvit`);
      else update("voice", "fail", "Žádný český hlas — Nastavení systému › Zpřístupnění › Předčítaný obsah › Hlasy");
    };
    if (window.speechSynthesis.getVoices().length > 0) checkVoices();
    else {
      window.speechSynthesis.onvoiceschanged = checkVoices;
      setTimeout(checkVoices, 1500);
    }

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function testMic() {
    setM("mic", "pending", "Řekni něco česky...");
    const text = await listenOnce("cs-CZ", 6000);
    if (text) setM("mic", "ok", `Slyšel jsem: „${text}“`);
    else setM("mic", "fail", "Nic jsem neslyšel — mikrofon, oprávnění, nebo chybí internet");
  }

  async function testSpeak() {
    setM("speak", "pending", "Mluvím...");
    await speak("Vítej v kouzelnické akademii!");
    setM("speak", "ok", "Slyšel jsi hlas? Pokud ne, zkontroluj hlasitost/výstup zvuku (HDMI → TV)");
  }

  async function testLamp(state: "on" | "off") {
    setM("lamp", "pending", state === "on" ? "Zapínám..." : "Vypínám...");
    try {
      const res = await fetch("/api/lamp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) setM("lamp", "ok", `Zkratka proběhla (${state === "on" ? "LumosOn" : "LumosOff"}) — reagovala lampa?`);
      else setM("lamp", "fail", data.error ?? "chyba");
    } catch (err) {
      setM("lamp", "fail", String(err));
    }
  }

  const row = (label: string, check: Check | undefined, action?: React.ReactNode) => (
    <div className="flex items-start gap-3 rounded-lg bg-neutral-900 px-4 py-3">
      <span className="text-xl leading-7">{ICON[check?.state ?? "pending"]}</span>
      <div className="flex-1">
        <p className="font-semibold">{label}</p>
        {check && <p className="text-sm text-white/60">{check.detail}</p>}
      </div>
      {action}
    </div>
  );

  const button = (label: string, onClick: () => void) => (
    <button onClick={onClick} className="shrink-0 rounded bg-yellow-500 text-black font-semibold px-3 py-1 hover:bg-yellow-400">
      {label}
    </button>
  );

  return (
    <main className="min-h-screen bg-black text-white p-8 flex flex-col items-center gap-6">
      <div className="text-center">
        <Link href="/" className="text-white/40 hover:text-white text-sm">
          ‹ Zpět na rozcestník
        </Link>
        <h1 className="text-3xl font-semibold mt-2">🔧 Kontrola před startem</h1>
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          {AUTO_CHECKS.map((c) => (
            <div key={c.id}>{row(c.label, checks[c.id])}</div>
          ))}
          <h2 className="text-lg font-semibold mt-3">Ruční testy</h2>
          {row("Mikrofon + rozpoznávání řeči", manual.mic, button("🎤 Test", testMic))}
          {row("Hlas (reproduktory)", manual.speak, button("🔊 Test", testSpeak))}
          {row(
            "Lampa (HomeKit)",
            manual.lamp,
            <div className="flex gap-2">
              {button("💡 Zap", () => testLamp("on"))}
              {button("🌑 Vyp", () => testLamp("off"))}
            </div>
          )}
        </div>
        <div>
          <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-neutral-900 -scale-x-100" />
          <p className="text-sm text-white/50 mt-2">Náhled kamery (zrcadlově, jako ve hrách)</p>
        </div>
      </div>
    </main>
  );
}
