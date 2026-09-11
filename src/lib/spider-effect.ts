type Landmark = { x: number; y: number; z: number };

// A curated, safe subset of MediaPipe's 468 face-mesh landmark indices —
// open-skin spots (forehead, cheeks, chin, nose, between the eyebrows),
// deliberately avoiding the eyes/mouth area.
const FACE_ANCHOR_INDICES = [10, 1, 152, 234, 454, 9];
const LEFT_FACE_EDGE = 234;
const RIGHT_FACE_EDGE = 454;

const MOVE_DURATION_MS = [900, 1400] as const;
const PAUSE_DURATION_MS = [300, 700] as const;
const BANISH_DURATION_MS = 500;
const SPIDER_EMOJI = "🕷️";

function randRange([min, max]: readonly [number, number]) {
  return min + Math.random() * (max - min);
}

function pickOtherIndex(current: number, count: number): number {
  if (count <= 1) return current;
  let next = current;
  while (next === current) next = Math.floor(Math.random() * count);
  return next;
}

export class SpiderEffect {
  private currentAnchor = 0;
  private targetAnchor = 0;
  private moveStart = 0;
  private moveDuration = 1000;
  private pauseUntil = 0;
  private banishing = false;
  private banishStart = 0;
  private done = false;

  constructor() {
    this.targetAnchor = pickOtherIndex(this.currentAnchor, FACE_ANCHOR_INDICES.length);
  }

  banish() {
    if (this.banishing) return;
    this.banishing = true;
    this.banishStart = performance.now();
  }

  isDone() {
    return this.done;
  }

  // Returns the current on-screen pixel position (useful for placing UI
  // like an instruction hint near the spider), or null if no face detected.
  render(
    ctx: CanvasRenderingContext2D,
    faceLandmarks: Landmark[] | undefined,
    canvasWidth: number,
    canvasHeight: number,
    now: number
  ): { x: number; y: number } | null {
    if (this.done || !faceLandmarks) return null;

    if (!this.banishing) {
      const elapsed = now - this.moveStart;
      if (now >= this.pauseUntil && elapsed >= this.moveDuration) {
        this.currentAnchor = this.targetAnchor;
        this.targetAnchor = pickOtherIndex(this.currentAnchor, FACE_ANCHOR_INDICES.length);
        this.moveStart = now;
        this.moveDuration = randRange(MOVE_DURATION_MS);
        this.pauseUntil = now + this.moveDuration + randRange(PAUSE_DURATION_MS);
      }
    }

    const fromIdx = FACE_ANCHOR_INDICES[this.currentAnchor];
    const toIdx = FACE_ANCHOR_INDICES[this.targetAnchor];
    const from = faceLandmarks[fromIdx];
    const to = faceLandmarks[toIdx];
    if (!from || !to) return null;

    const moveElapsed = now - this.moveStart;
    const t = Math.max(0, Math.min(1, moveElapsed / this.moveDuration));
    const eased = t * t * (3 - 2 * t); // smoothstep

    const nx = from.x + (to.x - from.x) * eased;
    const ny = from.y + (to.y - from.y) * eased;

    // Small multi-legged wobble, always active so it never looks frozen.
    const wobbleX = Math.sin(now / 90) * 0.004;
    const wobbleY = Math.cos(now / 130) * 0.004;

    const px = (nx + wobbleX) * canvasWidth;
    const py = (ny + wobbleY) * canvasHeight;

    const leftEdge = faceLandmarks[LEFT_FACE_EDGE];
    const rightEdge = faceLandmarks[RIGHT_FACE_EDGE];
    const faceWidthPx = leftEdge && rightEdge ? Math.abs(rightEdge.x - leftEdge.x) * canvasWidth : canvasWidth * 0.2;
    const baseSize = faceWidthPx * 0.4;

    let scale = 1;
    let alpha = 1;
    if (this.banishing) {
      const bElapsed = now - this.banishStart;
      const bt = Math.min(1, bElapsed / BANISH_DURATION_MS);
      scale = 1 - bt;
      alpha = 1 - bt;
      if (bt >= 1) this.done = true;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${Math.max(1, baseSize * scale)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SPIDER_EMOJI, px, py);
    ctx.restore();

    return { x: px, y: py };
  }
}
