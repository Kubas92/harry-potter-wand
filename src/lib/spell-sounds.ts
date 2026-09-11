export type SpellId = "lumos" | "nox" | "wingardium" | "expelliarmus" | "patronus" | "banish";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function tone(
  ctx: AudioContext,
  startTime: number,
  freqFrom: number,
  freqTo: number,
  duration: number,
  gain = 0.2
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freqFrom, startTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), startTime + duration);
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gain, startTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function sparkle(ctx: AudioContext, startTime: number, notes: number[], gap = 0.06) {
  notes.forEach((freq, i) => tone(ctx, startTime + i * gap, freq, freq * 1.5, 0.15, 0.12));
}

export function playSpellSound(spell: SpellId) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;

  switch (spell) {
    case "lumos":
      sparkle(ctx, now, [523, 659, 784, 1046]); // rising sparkle
      break;
    case "nox":
      tone(ctx, now, 700, 120, 0.5, 0.2); // falling whoosh
      break;
    case "wingardium":
      tone(ctx, now, 300, 900, 0.6, 0.18); // floating rise
      sparkle(ctx, now + 0.3, [880, 1174], 0.1);
      break;
    case "expelliarmus":
      tone(ctx, now, 900, 200, 0.25, 0.25); // sharp snap
      tone(ctx, now + 0.1, 200, 60, 0.3, 0.2);
      break;
    case "patronus":
      tone(ctx, now, 200, 700, 1.4, 0.15); // slow shimmering rise
      sparkle(ctx, now + 0.2, [660, 880, 1046, 1318, 1568], 0.12);
      break;
    case "banish":
      tone(ctx, now, 500, 3000, 0.2, 0.22); // quick upward zap
      sparkle(ctx, now + 0.15, [1568, 2093], 0.08); // tiny "poof"
      break;
  }
}
