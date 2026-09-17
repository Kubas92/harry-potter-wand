import { cutoutImageByLuminance, loadImage } from "./image-cutout";

const FADE_IN_MS = 600;
const HOLD_MS = 2200;
const FADE_OUT_MS = 1400;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;
const CUTOUT_SIZE = 700; // offscreen processing resolution (long edge, px)

export class PatronusEffect {
  private startTime = 0;
  private active = false;
  private cutout: HTMLCanvasElement | null = null;
  private aspect = 1;
  private drawBox = { x: 0, y: 0, w: 0, h: 0 };

  async loadShape(imageUrl: string): Promise<void> {
    const img = await loadImage(imageUrl);
    const { canvas, aspect } = cutoutImageByLuminance(img, CUTOUT_SIZE);
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
