const FADE_IN_MS = 600;
const HOLD_MS = 2200;
const FADE_OUT_MS = 1400;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;
const CUTOUT_SIZE = 700; // offscreen processing resolution (long edge, px)

// Cuts the dark/light background out of the source image using luminance as
// alpha (the source is a soft painted glow, so this naturally gives a soft
// edge without any extra feathering step), producing a canvas with a
// transparent background that can be drawn directly.
function buildCutout(img: HTMLImageElement): { canvas: HTMLCanvasElement; aspect: number } {
  const aspect = img.naturalWidth / img.naturalHeight;
  const width = aspect >= 1 ? CUTOUT_SIZE : Math.round(CUTOUT_SIZE * aspect);
  const height = aspect >= 1 ? Math.round(CUTOUT_SIZE / aspect) : CUTOUT_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Figure out whether the subject is the light pixels (a glow on a dark
  // background) or the dark pixels (silhouette on a light background) by
  // checking which is the minority — the subject usually covers less area.
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
    // Push background toward true-0 alpha while keeping the glow's falloff.
    data[i + 3] = Math.max(0, Math.min(255, (brightness - 35) * 1.6));
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, aspect };
}

export class PatronusEffect {
  private startTime = 0;
  private active = false;
  private cutout: HTMLCanvasElement | null = null;
  private aspect = 1;
  private drawBox = { x: 0, y: 0, w: 0, h: 0 };

  async loadShape(imageUrl: string): Promise<void> {
    const img = new Image();
    img.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to load ${imageUrl}`));
    });
    const { canvas, aspect } = buildCutout(img);
    this.cutout = canvas;
    this.aspect = aspect;
    console.log("[wand] patronus shape ready");
  }

  isActive() {
    return this.active;
  }

  trigger(canvasWidth: number, canvasHeight: number) {
    if (!this.cutout) {
      console.warn("[wand] patronus shape not loaded yet, skipping");
      return;
    }

    const maxW = canvasWidth * 0.55;
    const maxH = canvasHeight * 0.7;
    let w = maxW;
    let h = w / this.aspect;
    if (h > maxH) {
      h = maxH;
      w = h * this.aspect;
    }
    this.drawBox = {
      x: canvasWidth * 0.5 - w / 2,
      y: canvasHeight * 0.5 - h / 2,
      w,
      h,
    };

    this.startTime = performance.now();
    this.active = true;
  }

  update(now: number) {
    if (!this.active) return;
    if (now - this.startTime > TOTAL_MS) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.active || !this.cutout) return;
    const elapsed = now - this.startTime;

    let opacity: number;
    if (elapsed < FADE_IN_MS) {
      opacity = elapsed / FADE_IN_MS;
    } else if (elapsed < FADE_IN_MS + HOLD_MS) {
      opacity = 1;
    } else {
      const fadeElapsed = elapsed - FADE_IN_MS - HOLD_MS;
      opacity = Math.max(0, 1 - fadeElapsed / FADE_OUT_MS);
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    // Plain alpha blending (not "lighter"/additive) — additive light gets
    // washed out against a bright background like the Hogwarts sunset.
    // A soft, gently pulsing glow around the shape — cheap (one shadow on
    // one drawImage call, not per-particle) but reads as "magical".
    const pulse = 24 + Math.sin(now / 400) * 8;
    ctx.shadowColor = "rgba(150,200,255,0.9)";
    ctx.shadowBlur = pulse * opacity;
    const { x, y, w, h } = this.drawBox;
    ctx.drawImage(this.cutout, x, y, w, h);
    ctx.restore();
  }
}
