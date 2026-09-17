type Vec2 = { x: number; y: number };

// A jagged lightning-bolt "shot" from the wand tip — an instant flash, not a
// slow-traveling projectile (real lightning cracks into view all at once and
// fades, it doesn't fly across the screen like a thrown ball — the first
// version of this effect was a moving glowing orb + trail, which read as
// "shot a ball" rather than "shot lightning"). Pure code-driven animation
// (a zigzag path generated once per cast, then revealed/faded over time), no
// image/GIF asset needed. Drawn in screen-space (not mirrored) since the
// caller passes an already-mirrored origin — see kouzla/hra/page.tsx.
const GROW_MS = 70; // the "crack" — path reveals almost instantly
const HOLD_MS = 90; // full brightness, the flash itself
const FADE_MS = 220;
const TOTAL_MS = GROW_MS + HOLD_MS + FADE_MS;

const SEGMENTS = 7;
const ZIGZAG_AMPLITUDE = 20; // px, perpendicular offset at the sharpest zigzag

export class SpellBoltEffect {
  private active = false;
  private startTime = 0;
  private points: Vec2[] = [];
  private color = "#22ff6a";

  // `length` in pixels — pass e.g. `canvasWidth * 1.05` so it visibly exits
  // the screen regardless of resolution.
  trigger(origin: Vec2, direction: Vec2, length: number, color: string) {
    const len = Math.hypot(direction.x, direction.y) || 1;
    const dir = { x: direction.x / len, y: direction.y / len };
    const perp = { x: -dir.y, y: dir.x };

    const points: Vec2[] = [origin];
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const alongX = origin.x + dir.x * length * t;
      const alongY = origin.y + dir.y * length * t;
      // Alternating zigzag, tapering off toward the tip and landing exactly
      // on the straight line at the very end so it doesn't look clipped.
      const isLast = i === SEGMENTS;
      const side = i % 2 === 0 ? 1 : -1;
      const amp = isLast ? 0 : ZIGZAG_AMPLITUDE * (1 - t * 0.3) * side;
      points.push({ x: alongX + perp.x * amp, y: alongY + perp.y * amp });
    }

    this.points = points;
    this.color = color;
    this.startTime = performance.now();
    this.active = true;
  }

  render(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.active) return;

    const elapsed = now - this.startTime;
    if (elapsed > TOTAL_MS) {
      this.active = false;
      return;
    }

    let alpha = 1;
    let visibleFraction = 1;
    if (elapsed < GROW_MS) {
      visibleFraction = elapsed / GROW_MS;
    } else if (elapsed > GROW_MS + HOLD_MS) {
      alpha = 1 - (elapsed - GROW_MS - HOLD_MS) / FADE_MS;
    }

    const visibleCount = Math.max(2, Math.ceil(this.points.length * visibleFraction));
    const visiblePoints = this.points.slice(0, visibleCount);

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    visiblePoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    // Bright white-hot core on top of the colored bolt, thinner.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();
  }
}
