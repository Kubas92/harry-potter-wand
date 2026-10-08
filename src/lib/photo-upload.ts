// Client-side half of the reaction-photo feature (server side:
// src/app/api/photos/, src/lib/photo-store.ts). Fire-and-forget — a failed
// save must never break a game, so errors are only console.warn'd.
import { WEB_BUILD } from "./web-build";

export const PHOTO_JPEG_QUALITY = 0.85;

// "2026-09-24-14-05-33_<suffix>" — sorts chronologically, safe as a folder name.
export function newPhotoSession(suffix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${stamp}_${suffix}`;
}

export function uploadPhoto(game: string, session: string, label: string, blob: Blob | null) {
  if (!blob || WEB_BUILD) return;
  const params = new URLSearchParams({ game, session, label });
  fetch(`/api/photos?${params}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  }).catch((err) => console.warn(`[${game}] photo save failed:`, err));
}

export function uploadCanvasPhoto(game: string, session: string, label: string, canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => uploadPhoto(game, session, label, blob), "image/jpeg", PHOTO_JPEG_QUALITY);
}

export function saveSessionMeta(game: string, session: string, meta: { name?: string; patronus?: string }) {
  if (WEB_BUILD) return;
  fetch("/api/photos/meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game, session, ...meta }),
  }).catch((err) => console.warn(`[${game}] meta save failed:`, err));
}
