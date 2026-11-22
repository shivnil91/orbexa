"use client";

import { useState } from "react";
import { secondaryButton } from "./styles";

export function SandboxPanel({ testLabel, testingLabel, errorLabel, title }: { testLabel: string; testingLabel: string; errorLabel: string; title: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [text, setText] = useState("");

  async function run(form: HTMLFormElement) {
    setState("loading");
    const response = await fetch("/api/agents/sandbox", { method: "POST", body: new FormData(form), headers: { accept: "application/json" } });
    if (!response.ok) {
      setState("error");
      return;
    }
    const payload = (await response.json()) as { paragraphs?: string[] };
    setText((payload.paragraphs ?? []).join("\n\n"));
    setState("done");
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-line p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <button
        className={secondaryButton}
        type="button"
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (form) {
            void run(form);
          }
        }}
      >
        {state === "loading" ? testingLabel : testLabel}
      </button>
      {state === "error" ? <p role="alert" className="text-sm text-missing">{errorLabel}</p> : null}
      {state === "done" ? <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6">{text}</pre> : null}
    </div>
  );
}
