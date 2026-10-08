import { mkdir, writeFile } from "node:fs/promises";
import { isValidSessionRef, listSessions, photosPath, SAFE_SEGMENT } from "@/lib/photo-store";

// POST: saves a JPEG snapshot of a game canvas into
// photos/<game>/<session>/ — bubaci/hra takes a short burst whenever a
// boggart appears, kouzla/hra when a Patronus is cast. GET: lists every
// session (used by /fotky's slideshow, /diplomy, and /kontrola). Same "this
// one Mac talking to itself" scope as /api/lamp.
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET() {
  return Response.json({ ok: true, sessions: await listSessions() });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game") ?? "";
  const session = url.searchParams.get("session") ?? "";
  const label = url.searchParams.get("label") ?? "photo";

  if (!isValidSessionRef(game, session) || !SAFE_SEGMENT.test(label)) {
    return Response.json({ ok: false, error: "invalid game/session/label" }, { status: 400 });
  }
  if (request.headers.get("content-type") !== "image/jpeg") {
    return Response.json({ ok: false, error: "expected image/jpeg" }, { status: 415 });
  }

  const data = Buffer.from(await request.arrayBuffer());
  if (data.length === 0 || data.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "bad image size" }, { status: 413 });
  }

  await mkdir(photosPath(game, session), { recursive: true });
  const file = `${Date.now()}-${label}.jpg`;
  await writeFile(photosPath(game, session, file), data);

  return Response.json({ ok: true, file: `photos/${game}/${session}/${file}` });
}
