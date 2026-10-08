import { cutoutImageByLuminance, loadImage } from "./image-cutout";

// Screen-space "jump scare": invisible while idle, then after a randomized
// delay it snaps into view already at full open-mouth strike and flies
// toward wherever the child's face currently is, holds for a beat, retreats
// out of view, and repeats — until banished. Reuses the same FaceLandmarker
// already loaded for the `spiders` variant (see bubaci/hra/page.tsx) to aim;
// the target is captured once when a strike begins (not re-tracked mid-lunge,
// which would look like it curves in the air) so moving between strikes
// changes where the *next* one aims.
//
// This started as a hand-drawn (canvas-path) head with a hinged jaw that
// opened during the lunge, same technique as kouzla/hra's tutorial arrow —
// but simple flat-color vector shapes read as cartoonish, not menacing. A
// real photo/illustration (cut out via luminance-as-alpha, same as
// DementorEffect/PatronusEffect) reads far more convincingly, so the source
// image is expected to *already* show the snake mid-strike, mouth open —
// there's no separate closed-mouth pose to animate from.
const CUTOUT_SIZE = 700;

const COIL_POSITIONS = [
  { x: 0.22, y: 0.98 },
  { x: 0.78, y: 0.98 },
] as const;
// Used when no face is currently detected (e.g. nobody in frame yet).
const FALLBACK_TARGET = { x: 0.5, y: 0.42 }; // roughly face height, screen center

const STRIKE_DELAY_MS: readonly [number, number] = [1000, 2000]; // invisible wait before each strike
const LUNGE_MS = 200;
const HOLD_MS = 900; // how long it stays at full size/strike position before retreating
const RETREAT_MS = 260;
const BANISH_DURATION_MS = 400;

const START_WIDTH_FRACTION = 0.14; // fraction of canvas width at the start of a lunge
const PEAK_WIDTH_FRACTION = 0.42; // fraction of canvas width at full strike — big, "in your face"

type Phase = "idle" | "lunging" | "holding" | "retreating";

function randRange([min, max]: readonly [number, number]) {
  return min + Math.random() * (max - min);
}

export class SnakeEffect {
  private cutout: HTMLCanvasElement | null = null;
  private aspect = 1;
  private coil: { x: number; y: number } = COIL_POSITIONS[0];
  private target: { x: number; y: number } = FALLBACK_TARGET;
  private phase: Phase = "idle";
  private phaseStart = 0;
  private nextStrikeDelay = 0;
  private banishing = false;
  private banishStart = 0;
  private done = false;
  // Monotonic count of strikes that reached full size — bubaci/hra watches
  // this to snap reaction photos at the scariest moment of each strike.
  private strikeCount = 0;

  constructor() {
    this.resetState();
  }

  async loadShape(imageUrl: string): Promise<void> {
    const img = await loadImage(imageUrl);
    const { canvas, aspect } = cutoutImageByLuminance(img, CUTOUT_SIZE);
    this.cutout = canvas;
    this.aspect = aspect;
    console.log("[bubaci] snake shape ready");
  }

  private resetState() {
    this.coil = COIL_POSITIONS[Math.floor(Math.random() * COIL_POSITIONS.length)];
    this.phase = "idle";
    this.phaseStart = performance.now();
    this.nextStrikeDelay = randRange(STRIKE_DELAY_MS);
    this.banishing = false;
    this.banishStart = 0;
    this.done = false;
  }

  // Reuses the instance for the next appearance — no asset loading involved
  // here (the image is loaded once, up front), but matches DementorEffect's
  // "spawn() resets state" naming so both non-`new`-per-respawn effects read
  // consistently.
  spawn() {
    this.resetState();
  }

  banish() {
    if (this.banishing || this.done) return;
    if (this.phase === "idle") {
      // Nothing visible yet to animate away — just end immediately so the
      // respawn cycle isn't stuck waiting on a fade that has nothing to fade.
      this.done = true;
      return;
    }
    this.banishing = true;
    this.banishStart = performance.now();
  }

  isDone() {
    return this.done;
  }

  getStrikeCount() {
    return this.strikeCount;
  }

  // Static draw for bubaci/hra's "portrait" reaction photo (snake lurking
  // behind the kid instead of filling the screen) — centered at (cx, cy)
  // px, `width` px wide, independent of the strike state machine. Returns
  // false if the image isn't loaded, so the caller can skip the photo.
  drawPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number): boolean {
    if (!this.cutout) return false;
    const h = width / this.aspect;
    ctx.drawImage(this.cutout, cx - width / 2, cy - h / 2, width, h);
    return true;
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    now: number,
    faceTarget: { x: number; y: number } | null
  ) {
    if (this.done) return;

    if (!this.banishing) {
      const elapsed = now - this.phaseStart;
      if (this.phase === "idle" && elapsed >= this.nextStrikeDelay) {
        this.phase = "lunging";
        this.phaseStart = now;
        // Lock in this strike's aim now, rather than re-tracking every frame
        // — a target that keeps moving mid-lunge would look like the snake
        // is curving through the air instead of striking.
        this.target = faceTarget ?? FALLBACK_TARGET;
      } else if (this.phase === "lunging" && elapsed >= LUNGE_MS) {
        this.phase = "holding";
        this.phaseStart = now;
        this.strikeCount += 1;
      } else if (this.phase === "holding" && elapsed >= HOLD_MS) {
        this.phase = "retreating";
        this.phaseStart = now;
      } else if (this.phase === "retreating" && elapsed >= RETREAT_MS) {
        this.phase = "idle";
        this.phaseStart = now;
        this.nextStrikeDelay = randRange(STRIKE_DELAY_MS);
      }
    }

    if (this.phase === "idle") {
      // Invisible while waiting — it should ambush, not telegraph.
      return;
    }

    const phaseElapsed = now - this.phaseStart;
    // t: 0 = at the coil point (just appearing), 1 = fully struck at the
    // viewer, max size.
    let t: number;
    switch (this.phase) {
      case "lunging": {
        const lt = Math.min(1, phaseElapsed / LUNGE_MS);
        t = lt * lt; // sudden snap, not a smooth ease
        break;
      }
      case "holding":
        t = 1;
        break;
      default: {
        // retreating
        const rt = Math.min(1, phaseElapsed / RETREAT_MS);
        t = 1 - rt * rt * (3 - 2 * rt); // smoothstep back down
      }
    }

    const nx = this.coil.x + (this.target.x - this.coil.x) * t;
    const ny = this.coil.y + (this.target.y - this.coil.y) * t;
    const widthFraction = START_WIDTH_FRACTION + (PEAK_WIDTH_FRACTION - START_WIDTH_FRACTION) * t;

    let alpha = 1;
    let banishShrink = 1;
    if (this.banishing) {
      const bt = Math.min(1, (now - this.banishStart) / BANISH_DURATION_MS);
      alpha = 1 - bt;
      banishShrink = 1 - bt;
      if (bt >= 1) this.done = true;
    }

    // Only the actual drawing is skipped without an image — the state
    // machine above still runs so the game isn't stuck waiting on an asset
    // that hasn't been dropped into public/bubaci/ yet.
    if (!this.cutout) return;

    const w = canvasWidth * widthFraction * banishShrink;
    const h = w / this.aspect;
    const px = nx * canvasWidth - w / 2;
    const py = ny * canvasHeight - h / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.cutout, px, py, w, h);
    ctx.restore();
  }
}
