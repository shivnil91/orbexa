"use client";

import { useEffect, useRef, useState } from "react";
import { secondaryButton } from "./styles";

export function DraftActions({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        className={secondaryButton}
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        className={secondaryButton}
        type="button"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Download
      </button>
    </div>
  );
}

export function DraftPoll({ jobId, pending, failed }: { jobId: string; pending: string; failed: string }) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const response = await fetch(`/api/jobs/${jobId}/deliver`, { method: "POST", headers: { accept: "application/json" } });
      if (stopped) return;
      if (!response.ok) {
        setError(failed);
        return;
      }
      const body = await response.json() as { paragraphs?: string[]; refunded?: boolean; error?: string | null };
      if (body.refunded || body.error) {
        setError(failed);
        return;
      }
      if ((body.paragraphs ?? []).length > 0) {
        setParagraphs(body.paragraphs ?? []);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [failed, jobId]);

  if (error) {
    return <p role="alert" className="rounded-2xl bg-missing-bg p-4 text-sm leading-6 text-missing">{error}</p>;
  }
  if (!paragraphs) {
    return <p role="status" className="rounded-2xl border border-line bg-surface p-5 text-lg">{pending}</p>;
  }
  const text = paragraphs.join("\n\n");
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      {paragraphs.map((paragraph) => <p key={paragraph} className="mt-3 leading-7 first:mt-0">{paragraph}</p>)}
      <div className="mt-4">
        <DraftActions filename="draft.txt" text={text} />
      </div>
    </section>
  );
}

export function LiveSample({ name, instructions, sample }: { name: string; instructions: string; sample: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const body = new FormData();
    body.set("name", name);
    body.set("instructions", instructions);
    body.set("sample", sample);
    void fetch("/api/agents/sandbox", { method: "POST", body, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) {
          setState("error");
          return;
        }
        const payload = await response.json() as { paragraphs?: string[] };
        setText((payload.paragraphs ?? []).join("\n\n"));
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [instructions, name, sample]);

  return (
    <div className="mt-4 rounded-xl border border-line bg-background p-4">
      <h3 className="font-semibold">Sample for a buyer</h3>
      {state === "loading" ? <p role="status" className="mt-2 text-sm leading-6">Writing a sample…</p> : null}
      {state === "error" ? <p role="alert" className="mt-2 text-sm leading-6 text-missing">The sample did not finish. You can publish, then try a buyer request.</p> : null}
      {state === "ready" ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{text}</p> : null}
    </div>
  );
}
