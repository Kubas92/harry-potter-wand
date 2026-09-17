type Point = { x: number; y: number; t: number };

interface Spark {
  x: number;
  y: number;
  vx: number; // px/ms
  vy: number; // px/ms
  born: number;
  life: number;
  size: number;
  color: string;
}

const SPARK_COLORS = ["#facc15", "#fde68a", "#fff7d6", "#fbbf24"];
const SPARK_LIFETIME_MS: readonly [number, number] = [280, 420];
const SPARK_SPEED_RANGE: readonly [number, number] = [0.03, 0.11]; // px/ms
const SPARKS_PER_POINT = 2;
const MAX_SPARKS = 120;
const FRESH_POINT_MS = 60; // glow the tip only while it's still being actively tracked

// A lightweight "sparkler" look for the wand-tip trail, shared by kouzla/hra
// and bubaci/hra. Deliberately avoids per-particle gradients/shadowBlur (see
// patronus-effect.ts — an earlier particle system using those caused visible
// frame stutter): sparks are plain filled circles with no per-particle canvas
// state changes, and the only shadowBlur call is the single glowing tip dot,
// drawn once per frame regardless of how many trail points/sparks exist.
export class WandTrailEffect {
  private points: Point[] = [];
  private sparks: Spark[] = [];

  constructor(private trailLifetimeMs: number) {}

  addPoint(x: number, y: number, t: number) {
    this.points.push({ x, y, t });
    this.points = this.points.filter((p) => t - p.t < this.trailLifetimeMs);

    for (let i = 0; i < SPARKS_PER_POINT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SPARK_SPEED_RANGE[0] + Math.random() * (SPARK_SPEED_RANGE[1] - SPARK_SPEED_RANGE[0]);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: t,
        life: SPARK_LIFETIME_MS[0] + Math.random() * (SPARK_LIFETIME_MS[1] - SPARK_LIFETIME_MS[0]),
        size: 1.5 + Math.random() * 2,
        color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
      });
    }
    if (this.sparks.length > MAX_SPARKS) {
      this.sparks.splice(0, this.sparks.length - MAX_SPARKS);
    }
  }

  render(ctx: CanvasRenderingContext2D, now: number) {
    this.sparks = this.sparks.filter((s) => now - s.born < s.life);

    // Thin connective line beneath the dots — much subtler than a single
    // solid stroke (low alpha, tapering width/opacity by segment age) so it
    // reads as a soft streak rather than a hard line.
    ctx.lineCap = "round";
    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1];
      const curr = this.points[i];
      const freshness = 1 - (now - curr.t) / this.trailLifetimeMs;
      if (freshness <= 0) continue;
      ctx.globalAlpha = freshness * 0.35;
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1 + freshness * 1.5;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }

    // Fading comet-tail dots — oldest (dimmest, smallest) first so fresher
    // ones draw on top.
    for (const p of this.points) {
      const freshness = 1 - (now - p.t) / this.trailLifetimeMs;
      if (freshness <= 0) continue;
      ctx.globalAlpha = freshness * 0.7;
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + freshness * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sparks flying off and fading — position is derived from birth time
    // rather than integrated each frame, so there's no per-frame drift.
    for (const s of this.sparks) {
      const age = now - s.born;
      const remaining = 1 - age / s.life;
      if (remaining <= 0) continue;
      ctx.globalAlpha = remaining;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x + s.vx * age, s.y + s.vy * age, Math.max(0.5, s.size * remaining), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const tip = this.points[this.points.length - 1];
    if (tip && now - tip.t < FRESH_POINT_MS) {
      ctx.save();
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#fff7d6";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
