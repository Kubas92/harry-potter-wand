export type Direction = "right" | "left" | "up" | "down";

type Point = { x: number; y: number; t: number };

// Tuned for a fingertip tracked in normalized (0..1) video coordinates.
const MOVE_SPEED_THRESHOLD = 0.9; // normalized units/sec to count as "moving"
const STILL_SPEED_THRESHOLD = 0.35;
const MIN_GESTURE_DISTANCE = 0.18; // normalized units — filters out small jitter
const HISTORY_WINDOW_MS = 1000;
const COOLDOWN_MS = 900;

export class GestureDetector {
  private history: Point[] = [];
  private moving = false;
  private gestureStart: Point | null = null;
  private lastTriggerAt = 0;

  addSample(x: number, y: number, t: number): Direction | null {
    this.history.push({ x, y, t });
    this.history = this.history.filter((p) => t - p.t <= HISTORY_WINDOW_MS);

    if (this.history.length < 2) return null;
    const prev = this.history[this.history.length - 2];
    const dt = (t - prev.t) / 1000;
    if (dt <= 0) return null;

    const speed = Math.hypot(x - prev.x, y - prev.y) / dt;

    if (!this.moving && speed > MOVE_SPEED_THRESHOLD) {
      this.moving = true;
      this.gestureStart = prev;
    } else if (this.moving && speed < STILL_SPEED_THRESHOLD) {
      this.moving = false;
      const start = this.gestureStart;
      this.gestureStart = null;
      if (!start) return null;

      const dx = x - start.x;
      const dy = y - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance < MIN_GESTURE_DISTANCE) return null;
      if (t - this.lastTriggerAt < COOLDOWN_MS) return null;

      this.lastTriggerAt = t;
      return Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    }

    return null;
  }
}
