import { cutoutImageByLuminance, loadImage } from "./image-cutout";

type Vec2 = { x: number; y: number };

// A wandering golden snitch for the Quidditch-training mini-game
// (`famfrpal/hra`). Draws a supplied image if one's been loaded via
// `loadShape()` (cut out via luminance-as-alpha, same as
// DementorEffect/SnakeEffect/PatronusEffect — trusts existing transparency,
// or cuts a flat photo, whichever the source image actually is), falling
// back to a code-driven glowing-orb-with-flapping-wings placeholder
// otherwise — so the game is still fully playable/visible before an asset
// exists, same "tolerates a missing image" philosophy as DementorEffect.
//
// Movement is a simple "wander" steering behavior: pick a random point
// within the frame, fly toward it at a constant speed with periodic
// retargeting, so it changes direction erratically like a real snitch
// rather than moving in a predictable line. Position/size are all in pixel
// space (same convention as WandTrailEffect/SpellBoltEffect/FeatherEffect),
// parameterized by canvasWidth/canvasHeight each call rather than fixed, so
// it adapts to whatever camera resolution is actually in use.
const CUTOUT_SIZE = 400;
const EDGE_MARGIN = 0.14; // keeps the snitch away from the very edges of frame
const RETARGET_MS: readonly [number, number] = [400, 900]; // how often it picks a new direction
const SPEED_FRACTION_PER_SEC = 0.8; // fraction of canvas width traveled per second
const BODY_RADIUS = 16; // px — placeholder-shape size only
// The real snitch image is a wide "wings fully spread flat" shot (~2.2:1
// aspect), nothing like the compact placeholder circle, so it's sized as a
// fraction of canvas width instead of relative to BODY_RADIUS — otherwise it
// renders tiny and paper-thin at the placeholder's scale.
const IMAGE_WIDTH_FRACTION = 0.12;
const WING_FLAP_PERIOD_MS = 140;
// Spawn-anywhere mode (famfrpal/hra's expert level): minimum distance from
// the avoided point (the player's hand), as a fraction of canvas width, and
// how many random picks to try before settling for the farthest one.
const MIN_SPAWN_DISTANCE_FRACTION = 0.3;
const SPAWN_ATTEMPTS = 12;

function randRange([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

export class GoldenSnitchEffect {
  private position: Vec2 = { x: 0, y: 0 };
  private target: Vec2 = { x: 0, y: 0 };
  private nextRetargetAt = 0;
  private lastUpdateAt: number | null = null;
  private active = false;
  private cutout: HTMLCanvasElement | null = null;
  private aspect = 1;
  private speedMultiplier = 1;
  private spawnAnywhere = false;
  private retargetMultiplier = 1;

  // Scales SPEED_FRACTION_PER_SEC — used by famfrpal/hra's "pomalá" modes
  // for younger kids, without needing a separate slow-mode class/constant.
  setSpeedMultiplier(multiplier: number) {
    this.speedMultiplier = multiplier;
  }

  // Expert mode: spawn anywhere in frame (away from `avoid`) instead of near
  // the center, so a hand parked mid-screen doesn't catch every respawn.
  setSpawnAnywhere(enabled: boolean) {
    this.spawnAnywhere = enabled;
  }

  // Scales RETARGET_MS — expert mode changes direction more often, so it
  // dodges more sharply instead of flying straight for up to ~1s.
  setRetargetMultiplier(multiplier: number) {
    this.retargetMultiplier = multiplier;
  }

  async loadShape(imageUrl: string): Promise<void> {
    const img = await loadImage(imageUrl);
    const { canvas, aspect } = cutoutImageByLuminance(img, CUTOUT_SIZE);
    this.cutout = canvas;
    this.aspect = aspect;
    console.log("[famfrpal] snitch image ready");
  }

  spawn(canvasWidth: number, canvasHeight: number, now: number, avoid: Vec2 | null = null) {
    if (this.spawnAnywhere) {
      this.position = this.pickSpawnAwayFrom(canvasWidth, canvasHeight, avoid);
    } else {
      // Start somewhere reasonably central so it's never immediately at an
      // edge right after (re)spawning.
      this.position = {
        x: canvasWidth * randRange([0.35, 0.65]),
        y: canvasHeight * randRange([0.35, 0.65]),
      };
    }
    this.lastUpdateAt = now;
    this.active = true;
    this.pickNewTarget(canvasWidth, canvasHeight, now);
  }

  private pickSpawnAwayFrom(canvasWidth: number, canvasHeight: number, avoid: Vec2 | null): Vec2 {
    const randomPoint = () => ({
      x: canvasWidth * randRange([EDGE_MARGIN, 1 - EDGE_MARGIN]),
      y: canvasHeight * randRange([EDGE_MARGIN, 1 - EDGE_MARGIN]),
    });
    if (!avoid) return randomPoint();
    const minDist = canvasWidth * MIN_SPAWN_DISTANCE_FRACTION;
    let best = randomPoint();
    let bestDist = Math.hypot(best.x - avoid.x, best.y - avoid.y);
    for (let i = 1; i < SPAWN_ATTEMPTS && bestDist < minDist; i++) {
      const p = randomPoint();
      const d = Math.hypot(p.x - avoid.x, p.y - avoid.y);
      if (d > bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  private pickNewTarget(canvasWidth: number, canvasHeight: number, now: number) {
    this.target = {
      x: canvasWidth * randRange([EDGE_MARGIN, 1 - EDGE_MARGIN]),
      y: canvasHeight * randRange([EDGE_MARGIN, 1 - EDGE_MARGIN]),
    };
    this.nextRetargetAt = now + randRange(RETARGET_MS) * this.retargetMultiplier;
  }

  isActive() {
    return this.active;
  }

  // Hides the snitch without picking a new position — used to leave a brief
  // gap after a catch before spawn() places the next one, instead of
  // teleporting instantly (update()/render() both no-op while inactive).
  deactivate() {
    this.active = false;
  }

  getPosition(): Vec2 {
    return this.position;
  }

  update(canvasWidth: number, canvasHeight: number, now: number) {
    if (!this.active) return;

    if (now >= this.nextRetargetAt) this.pickNewTarget(canvasWidth, canvasHeight, now);

    const dtSec = (now - (this.lastUpdateAt ?? now)) / 1000;
    this.lastUpdateAt = now;

    const dx = this.target.x - this.position.x;
    const dy = this.target.y - this.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = canvasWidth * SPEED_FRACTION_PER_SEC * this.speedMultiplier;
    const step = Math.min(dist, speed * dtSec);
    this.position = {
      x: this.position.x + (dx / dist) * step,
      y: this.position.y + (dy / dist) * step,
    };
  }

  render(ctx: CanvasRenderingContext2D, canvasWidth: number, now: number) {
    if (!this.active) return;
    const { x, y } = this.position;

    if (this.cutout) {
      const w = canvasWidth * IMAGE_WIDTH_FRACTION;
      const h = w / this.aspect;
      ctx.save();
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 14;
      ctx.drawImage(this.cutout, x - w / 2, y - h / 2, w, h);
      ctx.restore();
      return;
    }

    // Placeholder shown until loadShape() resolves (or if it never does) —
    // glowing orb + two flapping wing shapes, all canvas paths, no asset.
    const wingFlap = Math.abs(Math.sin(now / WING_FLAP_PERIOD_MS));

    ctx.save();
    ctx.translate(x, y);

    // Wings — pale, flapping via a vertical squash/stretch, drawn behind
    // the body.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const side of [-1, 1] as const) {
      ctx.save();
      ctx.translate(side * BODY_RADIUS * 0.7, 0);
      ctx.scale(1, 0.35 + wingFlap * 0.55);
      ctx.beginPath();
      ctx.ellipse(0, 0, BODY_RADIUS * 1.3, BODY_RADIUS * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Glowing golden body on top — single shadowBlur call, same cheap-glow
    // approach used everywhere else in this app.
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(0, 0, BODY_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
