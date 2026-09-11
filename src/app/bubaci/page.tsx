"use client";

import { useState } from "react";
import Link from "next/link";

const BUBAK_TYPES = [{ id: "spiders", label: "Pavouci", emoji: "🕷️" }];

export default function BubaciSetupPage() {
  const [bubak, setBubak] = useState(BUBAK_TYPES[0].id);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center gap-10 p-8">
      <div>
        <Link href="/" className="text-white/40 hover:text-white text-sm">
          ‹ Zpět na rozcestník
        </Link>
        <h1 className="text-3xl font-semibold mt-2">Zažeň bubáka</h1>
      </div>

      <section className="w-full max-w-2xl">
        <h2 className="text-xl mb-3">Vyber bubáka</h2>
        <div className="grid grid-cols-2 gap-4">
          {BUBAK_TYPES.map((b) => (
            <button
              key={b.id}
              onClick={() => setBubak(b.id)}
              className={`rounded-lg overflow-hidden border-4 transition-colors bg-neutral-900 flex flex-col items-center ${
                bubak === b.id ? "border-yellow-400" : "border-transparent"
              }`}
            >
              <span className="text-7xl py-8">{b.emoji}</span>
              <p className="pb-3 text-sm">{b.label}</p>
            </button>
          ))}
        </div>
      </section>

      <Link
        href={`/bubaci/hra?bubak=${bubak}`}
        className="rounded bg-yellow-500 text-black font-semibold px-8 py-3 text-lg hover:bg-yellow-400"
      >
        👻 Začít
      </Link>
    </main>
  );
}
