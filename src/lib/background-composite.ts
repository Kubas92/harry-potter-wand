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
