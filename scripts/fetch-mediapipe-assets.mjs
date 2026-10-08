// Makes the app fully offline-capable for the camp (cottage WiFi can't be
// trusted): copies MediaPipe's WASM runtime out of node_modules and
// downloads the three ML models into public/mediapipe/, which
// src/lib/mediapipe-assets.ts points every page at. Idempotent — skips
// files that already exist. Runs automatically on `npm install`
// (postinstall) and before `npm run build`; can also be run by hand with
// `npm run fetch-assets`. public/mediapipe/ is gitignored (~45MB).
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = join(root, "public/mediapipe/wasm");
const modelsDest = join(root, "public/mediapipe/models");

const MODELS = {
  "hand_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "selfie_segmenter.tflite":
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
};

mkdirSync(wasmDest, { recursive: true });
mkdirSync(modelsDest, { recursive: true });

for (const file of readdirSync(wasmSrc)) {
  copyFileSync(join(wasmSrc, file), join(wasmDest, file));
}
console.log(`[assets] wasm copied → public/mediapipe/wasm`);

let failed = false;
for (const [file, url] of Object.entries(MODELS)) {
  const dest = join(modelsDest, file);
  if (existsSync(dest)) {
    console.log(`[assets] ${file} already present`);
    continue;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`[assets] downloaded ${file}`);
  } catch (err) {
    failed = true;
    console.error(`[assets] FAILED to download ${file}: ${err.message}`);
  }
}
if (failed) process.exitCode = 1;
