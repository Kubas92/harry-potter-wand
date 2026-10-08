import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Server-side helpers for photos/ (project root, gitignored — photos of
// kids, never commit them). Layout: photos/<game>/<session>/<file>.jpg,
// plus an optional meta.json per session (kouzla/hra writes the kid's name
// + patronus there for the printable diploma). Every path segment coming
// from a request is checked against SAFE_SEGMENT / ALLOWED_GAMES before
// it's joined onto PHOTOS_ROOT, so nothing can escape the folder.
export const PHOTOS_ROOT = join(/*turbopackIgnore: true*/ process.cwd(), "photos");

// All request-derived fs paths go through here — validated segments only,
// and the turbopackIgnore comment keeps `next build` from tracing the whole
// project into the server bundle because of a dynamic path.
export function photosPath(...segments: string[]) {
  return join(/*turbopackIgnore: true*/ PHOTOS_ROOT, ...segments);
}
export const ALLOWED_GAMES = new Set(["bubaci", "kouzla"]);
export const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
export const SAFE_FILE = /^[A-Za-z0-9_-]{1,120}\.jpg$/;

export type SessionMeta = { name?: string; patronus?: string };

export type PhotoSession = {
  game: string;
  session: string;
  photos: string[]; // file names, oldest first
  meta: SessionMeta | null;
};

export function isValidSessionRef(game: string, session: string) {
  return ALLOWED_GAMES.has(game) && SAFE_SEGMENT.test(session);
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export async function listSessions(): Promise<PhotoSession[]> {
  const result: PhotoSession[] = [];
  for (const game of ALLOWED_GAMES) {
    for (const session of await listDir(photosPath(game))) {
      if (!SAFE_SEGMENT.test(session)) continue;
      const dir = photosPath(game, session);
      const files = await listDir(dir);
      const photos = files.filter((f) => SAFE_FILE.test(f)).sort();
      let meta: SessionMeta | null = null;
      if (files.includes("meta.json")) {
        try {
          meta = JSON.parse(await readFile(photosPath(game, session, "meta.json"), "utf8"));
        } catch {
          meta = null;
        }
      }
      result.push({ game, session, photos, meta });
    }
  }
  // Session names start with an ISO-ish timestamp, so this is chronological.
  return result.sort((a, b) => a.session.localeCompare(b.session));
}

export function photoUrl(game: string, session: string, file: string) {
  return `/api/photos/file?${new URLSearchParams({ game, session, file })}`;
}
