// All MediaPipe assets are served locally from public/mediapipe/ (see
// scripts/fetch-mediapipe-assets.mjs) instead of jsdelivr/googleapis, so the
// games load with no internet at all — the camp cottage's WiFi can't be
// relied on.
import { asset } from "./web-build";

export const WASM_BASE = asset("/mediapipe/wasm");
export const HAND_MODEL_URL = asset("/mediapipe/models/hand_landmarker.task");
export const FACE_MODEL_URL = asset("/mediapipe/models/face_landmarker.task");
export const SEGMENTER_MODEL_URL = asset("/mediapipe/models/selfie_segmenter.tflite");
