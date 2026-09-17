// Cuts the person out of a video frame (using a MediaPipe segmentation
// confidence mask) by writing per-pixel alpha directly into its ImageData,
// so it can then be drawn on top of any background image with soft edges.
export function applyMaskAlpha(
  videoCtx: CanvasRenderingContext2D,
  videoWidth: number,
  videoHeight: number,
  maskData: Float32Array,
  maskWidth: number,
  maskHeight: number,
  invertMask: boolean
) {
  const frame = videoCtx.getImageData(0, 0, videoWidth, videoHeight);
  const data = frame.data;

  for (let y = 0; y < videoHeight; y++) {
    const maskY = Math.min(maskHeight - 1, Math.floor((y / videoHeight) * maskHeight));
    const rowOffset = maskY * maskWidth;
    for (let x = 0; x < videoWidth; x++) {
      const maskX = Math.min(maskWidth - 1, Math.floor((x / videoWidth) * maskWidth));
      let confidence = maskData[rowOffset + maskX] ?? 0;
      if (invertMask) confidence = 1 - confidence;
      const pixelIdx = (y * videoWidth + x) * 4;
      data[pixelIdx + 3] = confidence * 255;
    }
  }

  videoCtx.putImageData(frame, 0, 0);
}

export type NormalizedBounds = { minX: number; minY: number; maxX: number; maxY: number };

// Finds the on-screen bounding box of "person" pixels in a confidence mask
// (normalized 0-1, in the mask's own coordinate space — the same space the
// video/canvas are drawn in, so callers can multiply straight through by
// canvas width/height). Scans the mask at its own (much lower) resolution
// rather than the full video frame, so it's cheap to run every frame
// alongside applyMaskAlpha. Returns null if no pixel clears the threshold
// (nobody in frame).
export function computeMaskBounds(
  maskData: Float32Array,
  maskWidth: number,
  maskHeight: number,
  threshold: number,
  invertMask: boolean
): NormalizedBounds | null {
  let minX = maskWidth;
  let minY = maskHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < maskHeight; y++) {
    const rowOffset = y * maskWidth;
    for (let x = 0; x < maskWidth; x++) {
      let confidence = maskData[rowOffset + x] ?? 0;
      if (invertMask) confidence = 1 - confidence;
      if (confidence < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return {
    minX: minX / maskWidth,
    minY: minY / maskHeight,
    maxX: (maxX + 1) / maskWidth,
    maxY: (maxY + 1) / maskHeight,
  };
}
