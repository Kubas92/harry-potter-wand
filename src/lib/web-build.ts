// Public static build for GitHub Pages (`npm run build:web`, see
// scripts/build-web.mjs). There's no server there, so the lamp and photo
// API routes don't exist — WEB_BUILD turns those features off. The site is
// also served from a subpath (/<repo>/), which next/link and router.push
// handle on their own, but raw asset URLs (images, music, MediaPipe files)
// must go through asset().
export const WEB_BUILD = process.env.NEXT_PUBLIC_WEB_BUILD === "1";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}
