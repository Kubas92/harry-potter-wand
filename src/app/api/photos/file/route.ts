import { readFile } from "node:fs/promises";
import { isValidSessionRef, photosPath, SAFE_FILE } from "@/lib/photo-store";

// Serves one saved photo (photos/ is outside public/, so it needs a route).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game") ?? "";
  const session = url.searchParams.get("session") ?? "";
  const file = url.searchParams.get("file") ?? "";
  if (!isValidSessionRef(game, session) || !SAFE_FILE.test(file)) {
    return new Response("bad request", { status: 400 });
  }
  try {
    const data = await readFile(photosPath(game, session, file));
    return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
