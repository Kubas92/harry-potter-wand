import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isValidSessionRef, photosPath, SessionMeta } from "@/lib/photo-store";

// Merges fields into photos/<game>/<session>/meta.json — kouzla/hra stores
// the kid's name (as heard) and chosen patronus here for /diplomy.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { game?: unknown; session?: unknown; name?: unknown; patronus?: unknown }
    | null;
  const game = typeof body?.game === "string" ? body.game : "";
  const session = typeof body?.session === "string" ? body.session : "";
  if (!isValidSessionRef(game, session)) {
    return Response.json({ ok: false, error: "invalid game/session" }, { status: 400 });
  }

  await mkdir(photosPath(game, session), { recursive: true });
  const path = photosPath(game, session, "meta.json");
  let meta: SessionMeta = {};
  try {
    meta = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // no meta yet
  }
  if (typeof body?.name === "string") meta.name = body.name.slice(0, 60);
  if (typeof body?.patronus === "string") meta.patronus = body.patronus.slice(0, 40);
  await writeFile(path, JSON.stringify(meta, null, 2));
  return Response.json({ ok: true, meta });
}
