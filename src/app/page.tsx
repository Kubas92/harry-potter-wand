import Link from "next/link";
import { MenuBackground } from "./menu-background";
import { WEB_BUILD } from "@/lib/web-build";

const ACTIVITIES = [
  { href: "/kouzla", label: "Základy kouzel", emoji: "🪄" },
  { href: "/bubaci", label: "Zažeň bubáka", emoji: "👻" },
  { href: "/famfrpal", label: "Trénink famfrpálu", emoji: "🏆" },
];

// Operator tools (not activities for the kids) — kept small and out of the
// way at the bottom of the hub. They all need the local photo/lamp API, so
// the public web build hides them.
const TOOLS = [
  { href: "/kontrola", label: "🔧 Kontrola" },
  { href: "/fotky", label: "🖼 Fotky" },
  { href: "/diplomy", label: "📜 Diplomy" },
];

export default function HomePage() {
  return (
    <main className="relative isolate min-h-screen bg-black text-white flex flex-col items-center justify-center gap-8 p-8">
      <MenuBackground />

      <h1 className="relative z-10 text-4xl font-bold drop-shadow-lg">⚡ Kouzelnická akademie</h1>

      <div className="relative z-10 flex flex-col gap-4 w-full max-w-sm">
        {ACTIVITIES.map((activity) => (
          <Link
            key={activity.href}
            href={activity.href}
            className="rounded-lg border border-neutral-700 bg-black/30 px-6 py-5 text-xl text-center backdrop-blur-sm transition-colors hover:bg-black/50"
          >
            {activity.emoji} {activity.label}
          </Link>
        ))}
      </div>

      {!WEB_BUILD && (
        <nav className="absolute bottom-6 z-10 flex gap-6 text-sm text-white/40">
          {TOOLS.map((tool) => (
            <Link key={tool.href} href={tool.href} className="hover:text-white">
              {tool.label}
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}
