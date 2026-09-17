// Wingardium Leviosa's tutorial-only feather: appears hovering near the wand
// tip (tracking it live, like a feather balanced on the wand), then once the
// up-swipe lands it "lets go" and animates independently — rises quickly
// (the magical lift), then falls slowly with a gentle side-to-side sway and
// fades out (a real feather doesn't drop, it drifts down). Pure code-driven
// emoji animation, no asset, same reasoning as SpiderEffect/SnakeEffect's
// earlier iteration: 🪶 renders crisply at any size/rotation via ctx.font,
// so there's no need for an image here either.
//
// Deliberately tutorial-only (not a free-play visual like the Lumos glow or
// the Expelliarmus bolt) — the owner asked for it specifically as part of
// the guided Wingardium Leviosa step, not as something that fires on every
// subsequent up-swipe cast.
const HOVER_OFFSET_Y = -50; // px above the wand tip while idle
const BOB_AMPLITUDE = 6; // px
const BOB_PERIOD_MS = 1400;

const RISE_MS = 700;
const RISE_DISTANCE = 220; // px

const FALL_MS = 1900;
const FALL_DISTANCE = 240; // px, roughly drifts back past where it lifted off
const FALL_SWAY_AMPLITUDE = 28; // px, side-to-side drift while falling
const FALL_SWAY_CYCLES = 1.6;
const FADE_START_FRACTION = 0.55; // fraction of FALL_MS before it starts fading

const FEATHER_EMOJI = "🪶";
const FEATHER_SIZE = 80; // px (font-size) — bumped up from an initial 44, too small to read clearly live

type Phase = "hidden" | "idle" | "rising" | "falling" | "done";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class FeatherEffect {
  private phase: Phase = "hidden";
  private anchor = { x: 0, y: 0 };
  private liftoffPos = { x: 0, y: 0 };
  private phaseStart = 0;

  // Called when the Wingardium Leviosa tutorial step begins — makes the
  // feather appear hovering wherever the wand tip currently is.
  show(x: number, y: number) {
    this.phase = "idle";
    this.anchor = { x, y };
  }

  // Call every frame while idle with the current wand-tip position (raw
  // pixel coords, same space as WandTrailEffect). No-ops once it's lifted
  // off — a released feather doesn't chase your hand anymore.
  updateIdlePosition(x: number, y: number) {
    if (this.phase !== "idle") return;
    this.anchor = { x, y };
  }

  // Call once the up-swipe gesture lands. No-ops if not currently idle.
  liftoff(now: number) {
    if (this.phase !== "idle") return;
    this.phase = "rising";
    this.phaseStart = now;
    this.liftoffPos = { ...this.anchor };
  }

  isDone() {
    return this.phase === "done";
  }

  reset() {
    this.phase = "hidden";
  }

  render(ctx: CanvasRenderingContext2D, now: number) {
    if (this.phase === "hidden" || this.phase === "done") return;

    let x: number;
    let y: number;
    let rotation = 0;
    let alpha = 1;
    const size = FEATHER_SIZE;

    if (this.phase === "idle") {
      const bob = Math.sin(now / BOB_PERIOD_MS) * BOB_AMPLITUDE;
      x = this.anchor.x;
      y = this.anchor.y + HOVER_OFFSET_Y + bob;
      rotation = Math.sin(now / (BOB_PERIOD_MS * 1.3)) * 0.15;
    } else if (this.phase === "rising") {
      const elapsed = now - this.phaseStart;
      if (elapsed >= RISE_MS) {
        this.phase = "falling";
        this.phaseStart = now;
        x = this.liftoffPos.x;
        y = this.liftoffPos.y - RISE_DISTANCE;
      } else {
        const t = easeOutCubic(elapsed / RISE_MS);
        x = this.liftoffPos.x;
        y = this.liftoffPos.y - RISE_DISTANCE * t;
        rotation = Math.sin((elapsed / RISE_MS) * Math.PI) * 0.25;
      }
    } else {
      // falling
      const elapsed = now - this.phaseStart;
      if (elapsed >= FALL_MS) {
        this.phase = "done";
        return;
      }
      const t = elapsed / FALL_MS;
      const peakY = this.liftoffPos.y - RISE_DISTANCE;
      x = this.liftoffPos.x + Math.sin(t * Math.PI * 2 * FALL_SWAY_CYCLES) * FALL_SWAY_AMPLITUDE;
      y = peakY + FALL_DISTANCE * t; // straight-line descent, no easing — a gentle constant drift
      rotation = Math.sin(t * Math.PI * 2 * FALL_SWAY_CYCLES) * 0.35;
      if (t > FADE_START_FRACTION) {
        alpha = 1 - (t - FADE_START_FRACTION) / (1 - FADE_START_FRACTION);
      }
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.font = `${size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(FEATHER_EMOJI, 0, 0);
    ctx.restore();
  }
}
