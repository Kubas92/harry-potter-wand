import type { NextConfig } from "next";

// `npm run build:web` (scripts/build-web.mjs) sets these for the static
// GitHub Pages export; the camp build (`npm run camp`) leaves them unset.
const webBuild = process.env.NEXT_PUBLIC_WEB_BUILD === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

// The web build parks src/app/api outside src/app, which leaves stale
// references in .next/dev/types — so it skips Next's own type check
// (`npx tsc --noEmit` covers that separately).
const nextConfig: NextConfig = webBuild
  ? { output: "export", basePath, trailingSlash: true, typescript: { ignoreBuildErrors: true } }
  : {};

export default nextConfig;
