const DEFAULT_CUTOUT_SIZE = 700; // offscreen processing resolution (long edge, px)

// Cuts the background out of a source image using luminance as alpha, so any
// reasonably clean image on a plain background works with zero manual
// masking — auto-detects whether the subject is the light or dark pixels by
// checking which covers less of the frame (the subject usually covers less
// area than its background). Shared by every effect that loads a plain
// photo/painted-glow asset and needs it as a transparent cutout
// (PatronusEffect, DementorEffect).
export function cutoutImageByLuminance(
  img: HTMLImageElement,
  size: number = DEFAULT_CUTOUT_SIZE
): { canvas: HTMLCanvasElement; aspect: number } {
  const aspect = img.naturalWidth / img.naturalHeight;
  const width = aspect >= 1 ? size : Math.round(size * aspect);
  const height = aspect >= 1 ? Math.round(size / aspect) : size;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Some source files (e.g. a PNG someone already cut out) arrive with real
  // transparency rather than a flat photo background. Overwriting that with
  // a luminance guess would only make clean edges worse, so trust the
  // existing alpha instead whenever the corners are already transparent —
  // the reliable tell for "this is a pre-cut asset, not a plain photo."
  const corners = [
    (0 * width + 0) * 4,
    (0 * width + (width - 1)) * 4,
    ((height - 1) * width + 0) * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  const avgCornerAlpha = corners.reduce((sum, idx) => sum + data[idx + 3], 0) / corners.length;
  if (avgCornerAlpha < 20) {
    return { canvas, aspect };
  }

  let lightCount = 0;
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4 * 13) {
    const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (luminance > 128) lightCount++;
    sampleCount++;
  }
  const subjectIsDark = lightCount > sampleCount / 2;

  for (let i = 0; i < data.length; i += 4) {
    const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const brightness = subjectIsDark ? 255 - luminance : luminance;
    // Push background toward true-0 alpha while keeping the subject's falloff.
    data[i + 3] = Math.max(0, Math.min(255, (brightness - 35) * 1.6));
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, aspect };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
  });
}
