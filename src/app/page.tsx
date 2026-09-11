import Link from "next/link";
import { MenuBackground } from "./menu-background";

const ACTIVITIES = [
  { href: "/kouzla", label: "Základy kouzel", emoji: "🪄" },
  { href: "/bubaci", label: "Zažeň bubáka", emoji: "👻" },
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
    </main>
  );
}
