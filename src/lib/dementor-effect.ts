import { cutoutImageByLuminance, loadImage } from "./image-cutout";
import type { NormalizedBounds } from "./background-composite";

const CUTOUT_SIZE = 700;
const BANISH_DURATION_MS = 600;
const BOB_AMPLITUDE = 0.015; // fraction of canvas height
const BOB_PERIOD_MS = 2600;
// Drawn taller than the detected person so it looms above the head and
// below the feet — that's what sells "standing right behind you" once the
// person cutout is drawn on top and hides the overlapping middle.
const HEIGHT_VS_PERSON = 1.55;
const MAX_WIDTH_FRACTION = 0.6; // cap relative to canvas width, for a narrow/no-detection bbox

// Used before any person is detected yet (or briefly lost) so the dementor
// doesn't just vanish — a roughly person-shaped region centered in frame.
const FALLBACK_BOUNDS: NormalizedBounds = { minX: 0.32, minY: 0.12, maxX: 0.68, maxY: 0.95 };

export class DementorEffect {
  private cutout: HTMLCanvasElement | null = null;
  private aspect = 1;
  private banishing = false;
  private banishStart = 0;
  private done = false;

  async loadShape(imageUrl: string): Promise<void> {
    const img = await loadImage(imageUrl);
    const { canvas, aspect } = cutoutImageByLuminance(img, CUTOUT_SIZE);
    this.cutout = canvas;
    this.aspect = aspect;
    console.log("[bubaci] dementor shape ready");
  }

  // Resets banish/done state to reuse the already-loaded cutout for the next
  // appearance — unlike SpiderEffect (cheap to just `new` again), recreating
  // this effect would mean reloading and re-processing the image every
  // ~700ms respawn cycle.
  spawn() {
    this.banishing = false;
    this.banishStart = 0;
    this.done = false;
  }

  banish() {
    if (this.banishing) return;
    this.banishing = true;
    this.banishStart = performance.now();
  }

  isDone() {
    return this.done;
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    now: number,
    personBounds: NormalizedBounds | null
  ) {
    if (this.done) return;

    const bounds = personBounds ?? FALLBACK_BOUNDS;
    const bodyW = Math.max(1, (bounds.maxX - bounds.minX) * canvasWidth);
    const bodyH = Math.max(1, (bounds.maxY - bounds.minY) * canvasHeight);
    const bodyCx = ((bounds.minX + bounds.maxX) / 2) * canvasWidth;
    const bodyTop = bounds.minY * canvasHeight;

    let h = bodyH * HEIGHT_VS_PERSON;
    let w = h * this.aspect;
    const maxW = Math.max(bodyW * 1.3, canvasWidth * MAX_WIDTH_FRACTION);
    if (w > maxW) {
      w = maxW;
      h = w / this.aspect;
    }

    // Slow vertical bob so it never looks frozen, same idea as the spider's wobble.
    const bob = Math.sin((now / BOB_PERIOD_MS) * Math.PI * 2) * BOB_AMPLITUDE * canvasHeight;

    const x = bodyCx - w / 2;
    const y = bodyTop - (h - bodyH) * 0.65 + bob;

    let scale = 1;
    let alpha = 0.92;
    if (this.banishing) {
      const bt = Math.min(1, (now - this.banishStart) / BANISH_DURATION_MS);
      scale = 1 - bt;
      alpha = 0.92 * (1 - bt);
      if (bt >= 1) this.done = true;
    }

    // Only the actual drawing is skipped without an image — banish/respawn
    // timing still runs so the game isn't stuck waiting on an asset that
    // hasn't been dropped into public/bubaci/ yet.
    if (!this.cutout) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    ctx.drawImage(this.cutout, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
