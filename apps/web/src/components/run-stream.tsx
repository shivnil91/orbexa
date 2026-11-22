"use client";

import { useEffect, useState } from "react";
import type { JobRecord } from "@/lib/jobs";

export function RunStream({ jobId, initialCursor, initialStatus }: { jobId: string; initialCursor: number; initialStatus: string }) {
  const [cursor, setCursor] = useState(initialCursor);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (initialStatus !== "queued" && initialStatus !== "running") {
      return;
    }
    let stopped = false;
    const tick = async () => {
      while (!stopped) {
        const response = await fetch(`/api/jobs/${jobId}/step`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ locale: "en" }),
        });
        if (!response.ok) {
          return;
        }
        const job = (await response.json()) as Pick<JobRecord, "cursor" | "status">;
        if (stopped) {
          return;
        }
        setCursor(job.cursor);
        setStatus(job.status);
        if (job.status !== "queued" && job.status !== "running") {
          window.location.reload();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [jobId, initialStatus]);

  return <p className="sr-only">{`${status} ${cursor}`}</p>;
}
