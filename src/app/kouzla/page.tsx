"use client";

import { useState } from "react";
import Link from "next/link";
import ResolvedImage from "./resolved-image";
import { PATRONUS_CATALOG } from "@/lib/patronus-catalog";

const BACKGROUNDS = [
  { id: "1", label: "Bradavice" },
  { id: "2", label: "Bradavický expres" },
  { id: "3", label: "Bradavice - hala" },
];

const PATRONUSES = PATRONUS_CATALOG;

export default function KouzlaSetupPage() {
  const [background, setBackground] = useState("1");
  const [patronus, setPatronus] = useState("1");

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center gap-10 p-8">
      <div>
        <Link href="/" className="text-white/40 hover:text-white text-sm">
          ‹ Zpět na rozcestník
        </Link>
        <h1 className="text-3xl font-semibold mt-2">Základy kouzel</h1>
      </div>

      <section className="w-full max-w-3xl">
        <h2 className="text-xl mb-3">Vyber pozadí</h2>
        <div className="grid grid-cols-3 gap-4">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg.id}
              onClick={() => setBackground(bg.id)}
              className={`rounded-lg overflow-hidden border-4 transition-colors ${
                background === bg.id ? "border-yellow-400" : "border-transparent"
              }`}
            >
              <ResolvedImage basePath={`/backgrounds/${bg.id}`} alt={bg.label} className="w-full h-40 object-cover" />
              <p className="bg-neutral-900 py-2 text-sm">{bg.label}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="w-full max-w-3xl">
        <h2 className="text-xl mb-3">Vyber patrona</h2>
        <div className="grid grid-cols-4 gap-4">
          {PATRONUSES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPatronus(p.id)}
              className={`rounded-lg overflow-hidden border-4 transition-colors bg-neutral-900 ${
                patronus === p.id ? "border-yellow-400" : "border-transparent"
              }`}
            >
              <ResolvedImage basePath={`/patronus/${p.id}`} alt={p.label} className="w-full h-40 object-contain" />
              <p className="py-2 text-sm">{p.label}</p>
            </button>
          ))}
        </div>
      </section>

      <Link
        href={`/kouzla/hra?bg=${background}&patronus=${patronus}`}
        className="rounded bg-yellow-500 text-black font-semibold px-8 py-3 text-lg hover:bg-yellow-400"
      >
        ✨ Začít kouzlit
      </Link>
    </main>
  );
}
