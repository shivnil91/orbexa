"use client";

import { useEffect } from "react";

export function ProofPoller({ slug }: { slug: string }) {
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const response = await fetch(`/api/listings/${slug}/proof`, { cache: "no-store" });
      if (!response.ok || stopped) return;
      const body = (await response.json()) as { status?: string };
      if (body.status === "complete" || body.status === "failed") {
        window.location.reload();
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [slug]);
  return null;
}
