type Sample = { x: number; y: number; t: number };

// Detects "drew a circle" from a rolling trail of (normalized) wand-tip
// positions by looking at the *heading* (direction of travel) between
// consecutive points, rather than position relative to a centroid — a
// swipe-and-back motion can fake centroid-based angle sweeps (a natural
// arm-arc biases it consistently one way), but it can't fake a smoothly
// turning heading: a circle's heading rotates gradually in one direction
// the whole way around, while a swipe's heading *reverses sharply* at each
// end. A single sharp reversal disqualifies the gesture outright.
//
// The path is lightly smoothed (moving average) first so ordinary
// hand-tracking jitter on a real, wobbly, kid-drawn circle doesn't get
// mistaken for a reversal.
const HISTORY_WINDOW_MS = 1800;
const MIN_SAMPLES = 12;
const SMOOTHING_RADIUS = 2; // points on each side averaged together
const MIN_STEP_DIST = 0.008; // normalized units — ignores near-stationary jitter
const MAX_TURN_PER_STEP = Math.PI * (150 / 180); // ~150° — sharper than this = a reversal
const MIN_TOTAL_TURN = Math.PI * 1.6; // ~290° of consistent turning
const MIN_RADIUS = 0.06;
const COOLDOWN_MS = 1500;

function smooth(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const lo = Math.max(0, i - SMOOTHING_RADIUS);
    const hi = Math.min(points.length - 1, i + SMOOTHING_RADIUS);
    let sx = 0;
    let sy = 0;
    for (let j = lo; j <= hi; j++) {
      sx += points[j].x;
      sy += points[j].y;
    }
    const n = hi - lo + 1;
    out.push({ x: sx / n, y: sy / n });
  }
  return out;
}

export class CircleGestureDetector {
  private history: Sample[] = [];
  private lastTriggerAt = 0;

  addSample(x: number, y: number, t: number): boolean {
    this.history.push({ x, y, t });
    this.history = this.history.filter((p) => t - p.t <= HISTORY_WINDOW_MS);

    if (this.history.length < MIN_SAMPLES) return false;
    if (t - this.lastTriggerAt < COOLDOWN_MS) return false;

    const smoothed = smooth(this.history);

    // De-noised sequence of movement headings, skipping near-stationary
    // steps so hand jitter doesn't count as direction changes.
    const headings: number[] = [];
    let last = smoothed[0];
    for (let i = 1; i < smoothed.length; i++) {
      const p = smoothed[i];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (Math.hypot(dx, dy) < MIN_STEP_DIST) continue;
      headings.push(Math.atan2(dy, dx));
      last = p;
    }
    if (headings.length < 6) return false;

    let totalTurn = 0;
    for (let i = 1; i < headings.length; i++) {
      let delta = headings[i] - headings[i - 1];
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > MAX_TURN_PER_STEP) return false; // sharp reversal — not a circle
      totalTurn += delta;
    }

    const cx = this.history.reduce((sum, p) => sum + p.x, 0) / this.history.length;
    const cy = this.history.reduce((sum, p) => sum + p.y, 0) / this.history.length;
    const maxRadius = this.history.reduce(
      (max, p) => Math.max(max, Math.hypot(p.x - cx, p.y - cy)),
      0
    );

    if (Math.abs(totalTurn) >= MIN_TOTAL_TURN && maxRadius >= MIN_RADIUS) {
      this.lastTriggerAt = t;
      this.history = [];
      return true;
    }

    return false;
  }
}
