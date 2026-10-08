"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PhotoSession } from "@/lib/photo-store";
import { asset } from "@/lib/web-build";

// Evening slideshow of every reaction photo saved during the day (boggart
// bursts from bubaci/hra, Patronus casts from kouzla/hra) — meant for the
// TV. Click = fullscreen (+ starts the music, same autoplay workaround as
// the games), ←/→ = previous/next, space = pause. Re-fetches the list
// periodically so photos taken while it's already running show up too.
const SLIDE_MS = 4500;
const REFRESH_MS = 30_000;
const MUSIC_VOLUME = 0.3;

type Filter = "all" | "bubaci" | "kouzla";
type Slide = { key: string; url: string };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Vše" },
  { id: "bubaci", label: "👻 Bubáci" },
  { id: "kouzla", label: "🪄 Patroni" },
];

function toSlides(sessions: PhotoSession[], filter: Filter): Slide[] {
  return sessions
    .filter((s) => filter === "all" || s.game === filter)
    .flatMap((s) =>
      s.photos.map((file) => ({
        key: `${s.game}/${s.session}/${file}`,
        url: `/api/photos/file?${new URLSearchParams({ game: s.game, session: s.session, file })}`,
      }))
    );
}

export default function FotkyPage() {
  const [sessions, setSessions] = useState<PhotoSession[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const musicRef = useRef<HTMLAudioElement>(null);

  const slides = toSlides(sessions ?? [], filter);
  const count = slides.length;
  const current = count > 0 ? slides[index % count] : null;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/photos", { cache: "no-store" });
        const data = (await res.json()) as { sessions: PhotoSession[] };
        if (!cancelled) setSessions(data.sessions);
      } catch (err) {
        console.warn("[fotky] failed to load photo list:", err);
      }
    }
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((i) => (((i + delta) % count) + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (paused || count === 0) return;
    const t = setTimeout(() => step(1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [paused, count, index, step]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  function onClick() {
    const music = musicRef.current;
    if (music) {
      music.volume = MUSIC_VOLUME;
      music.play().catch(() => {});
    }
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  return (
    <main onClick={onClick} className="relative min-h-screen bg-black text-white overflow-hidden cursor-pointer">
      <audio ref={musicRef} src={asset("/music/background.mp3")} loop />

      {current && (
        // key = restart the fade/zoom animation on every slide change.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current.key}
          src={current.url}
          alt=""
          className="slideshow-image absolute inset-0 h-full w-full object-contain"
        />
      )}

      {sessions !== null && count === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-2xl text-white/60">
          Zatím tu nejsou žádné fotky.
        </p>
      )}

      {/* Controls — faded out so they don't distract on the TV. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 left-4 right-4 flex items-center gap-3 opacity-20 hover:opacity-100 transition-opacity"
      >
        <Link href="/" className="text-sm text-white/80 hover:text-white">
          ‹ Menu
        </Link>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setFilter(f.id);
              setIndex(0);
            }}
            className={`rounded px-3 py-1 text-sm ${filter === f.id ? "bg-yellow-500 text-black" : "bg-white/10"}`}
          >
            {f.label}
          </button>
        ))}
        <button onClick={() => setPaused((p) => !p)} className="rounded px-3 py-1 text-sm bg-white/10">
          {paused ? "▶ Pokračovat" : "⏸ Pauza"}
        </button>
        <span className="ml-auto text-sm text-white/70">
          {count > 0 ? `${(index % count) + 1} / ${count}` : ""}
        </span>
      </div>

      <style>{`
        .slideshow-image {
          animation: slideshow-in ${SLIDE_MS}ms ease-out both;
        }
        @keyframes slideshow-in {
          0% { opacity: 0; transform: scale(1); }
          12% { opacity: 1; }
          100% { opacity: 1; transform: scale(1.06); }
        }
      `}</style>
    </main>
  );
}
