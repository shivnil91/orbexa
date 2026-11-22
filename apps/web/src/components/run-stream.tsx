"use client";

import { useEffect, useState } from "react";
import type { JobRecord } from "@/lib/jobs";

export function RunStream({ jobId, initialCursor, initialStatus }: { jobId: string; initialCursor: number; initialStatus: string }) {
  const [cursor, setCursor] = useState(initialCursor);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (status !== "queued" && status !== "running") {
      return;
    }
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.onmessage = (event) => {
      const job = JSON.parse(event.data) as Pick<JobRecord, "cursor" | "status">;
      setCursor(job.cursor);
      setStatus(job.status);
      if (job.status !== "queued" && job.status !== "running") {
        source.close();
        window.location.reload();
      }
    };
    return () => source.close();
  }, [jobId, status]);

  return <p className="sr-only">{`${status} ${cursor}`}</p>;
}
