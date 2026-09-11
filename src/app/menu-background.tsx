"use client";

import { useEffect, useState } from "react";
import { resolveImageUrl } from "@/lib/resolve-asset";

// Drop an image at public/menu/background.(webp|jpg|jpeg|png) to customize
// the home hub's backdrop — extension doesn't matter, see resolveImageUrl.
// If no such file exists, this renders nothing and the hub keeps its plain
// black background.
export function MenuBackground() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveImageUrl("/menu/background")
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!src) return null;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- extension is resolved at runtime, next/image needs it statically */}
      <img src={src} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />
      <div className="absolute inset-0 z-0 bg-black/60" />
    </>
  );
}
