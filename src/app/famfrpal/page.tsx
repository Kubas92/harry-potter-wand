"use client";

import { useState } from "react";
import Link from "next/link";

// Fixed combinations of round length x snitch speed — no free-form
// picker, since these are the only ones actually needed: shorter/slower
// rounds are for younger kids in the group, "30s rychlá" is expected to be
// the one used most (keeps a line of older kids from getting bored waiting).
const MODES = [
  { id: "fast-60", emoji: "⚡", durationLabel: "1 minuta", speedLabel: "Rychlá", duration: 60, speed: "fast" },
  { id: "fast-30", emoji: "⚡", durationLabel: "30 sekund", speedLabel: "Rychlá", duration: 30, speed: "fast" },
  { id: "slow-60", emoji: "🐢", durationLabel: "1 minuta", speedLabel: "Pomalá", duration: 60, speed: "slow" },
  { id: "slow-30", emoji: "🐢", durationLabel: "30 sekund", speedLabel: "Pomalá", duration: 30, speed: "slow" },
  // Faster snitch that also respawns anywhere in frame (not just the center).
  { id: "expert-30", emoji: "🔥", durationLabel: "30 sekund", speedLabel: "Expert", duration: 30, speed: "expert" },
] as const;

export default function FamfrpalSetupPage() {
  const [modeId, setModeId] = useState<(typeof MODES)[number]["id"]>("fast-30");
  const mode = MODES.find((m) => m.id === modeId)!;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center gap-10 p-8">
      <div className="text-center">
        <Link href="/" className="text-white/40 hover:text-white text-sm">
          ‹ Zpět na rozcestník
        </Link>
        <h1 className="text-3xl font-semibold mt-2">Trénink famfrpálu</h1>
      </div>

      <p className="max-w-md text-lg text-white/80 text-center">
        Po hřišti poletuje zlatonka — chyť jich rukou co nejvíc, než vyprší čas!
      </p>

      <section className="w-full max-w-3xl">
        <h2 className="text-xl mb-3 text-center">Vyber délku a rychlost</h2>
        <div className="grid grid-cols-5 gap-4">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setModeId(m.id)}
              className={`rounded-lg overflow-hidden border-4 transition-colors bg-neutral-900 flex flex-col items-center ${
                modeId === m.id ? "border-yellow-400" : "border-transparent"
              }`}
            >
              <span className="text-6xl pt-6">{m.emoji}</span>
              <p className="pt-2 text-base font-semibold">{m.durationLabel}</p>
              <p className="pb-4 text-sm text-white/60">{m.speedLabel}</p>
            </button>
          ))}
        </div>
      </section>

      <Link
        href={`/famfrpal/hra?duration=${mode.duration}&speed=${mode.speed}`}
        className="rounded bg-yellow-500 text-black font-semibold px-8 py-3 text-lg hover:bg-yellow-400"
      >
        🏆 Začít trénink
      </Link>
    </main>
  );
}
