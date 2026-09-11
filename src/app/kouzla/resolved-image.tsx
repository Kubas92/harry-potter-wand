"use client";

import { useEffect, useState } from "react";
import { resolveImageUrl } from "@/lib/resolve-asset";

// Renders an <img> for a base path without a fixed extension (see
// resolveImageUrl) — so a thumbnail keeps working whatever image format
// someone drops into public/backgrounds or public/patronus.
export default function ResolvedImage({
  basePath,
  alt,
  className,
}: {
  basePath: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Reset to the loading placeholder whenever basePath changes — this is
    // a deliberate synchronous reset, not the risky pattern the rule warns
    // about (nothing here loops back into another render synchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrc(null);
    setFailed(false);
    resolveImageUrl(basePath)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-neutral-800 text-white/30 text-sm`}>
        chybí obrázek
      </div>
    );
  }

  if (!src) {
    return <div className={`${className} bg-neutral-800 animate-pulse`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
