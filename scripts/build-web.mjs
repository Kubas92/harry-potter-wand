// Static export for GitHub Pages → out/. Usage:
//   npm run build:web                 (served from /harry-potter-wand/)
//   BASE_PATH=/other npm run build:web
// `output: "export"` can't include the POST route handlers in src/app/api
// (lamp + photos only make sense on the camp Mac anyway), so they're moved
// out of src/app for the duration of the build and always put back.
import { execSync } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "src/app/api");
const apiParked = join(root, "src/api.web-build-parked");
const basePath = process.env.BASE_PATH ?? "/harry-potter-wand";

if (existsSync(apiParked)) {
  throw new Error(`${apiParked} exists — a previous build:web died mid-way; move it back to src/app/api first`);
}

renameSync(apiDir, apiParked);
try {
  execSync("next build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_WEB_BUILD: "1", NEXT_PUBLIC_BASE_PATH: basePath },
  });
} finally {
  renameSync(apiParked, apiDir);
}

// GitHub Pages runs Jekyll by default, which drops the `_next/` folder.
writeFileSync(join(root, "out/.nojekyll"), "");
console.log(`[build:web] done → out/ (base path ${basePath})`);
