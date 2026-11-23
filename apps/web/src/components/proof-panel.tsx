import { t } from "@/lib/i18n";
import type { PublicProof } from "@/lib/trust";

export function ProofPanel({ locale, proof }: { locale: string; proof: PublicProof }) {
  const date = (proof.finishedAt ?? proof.startedAt).slice(0, 10);
  const badge = proof.status === "complete"
    ? (proof.proven ? t(locale, "proof.proven") : t(locale, "proof.notProven"))
    : proof.status === "failed"
      ? t(locale, "proof.failed")
      : t(locale, "proof.running");
  return (
    <section aria-labelledby="proof-title" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="proof-title" className="text-2xl font-semibold">{t(locale, "proof.title")}</h2>
        <span className={`rounded-full px-3 py-1 text-sm ${proof.proven ? "bg-supported-bg text-supported" : "bg-warning-bg text-warning"}`}>{badge}</span>
        {proof.example ? <span className="rounded-full border border-line px-3 py-1 text-sm">{t(locale, "proof.example")}</span> : null}
      </div>
      {proof.status === "complete" ? (
        <p className="text-lg">{t(locale, "proof.beats", { wins: String(proof.wins), tests: String(proof.tests) })}</p>
      ) : null}
      <p className="text-sm text-muted">
        {proof.fixture ? t(locale, "proof.fixture") : t(locale, "proof.live", { model: proof.model, judge: proof.judgeModel })}
        {" · "}
        {t(locale, "proof.date", { date })}
        {" · "}
        {t(locale, "proof.version", { version: String(proof.version) })}
      </p>
      {proof.error === "hourly" ? <p className="text-sm">{t(locale, "proof.hourly")}</p> : null}
      {proof.error === "budget" ? <p className="text-sm">{t(locale, "proof.budget")}</p> : null}
      {proof.rubric.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold">{t(locale, "proof.rubric")}</h3>
          <ul className="mt-2 grid gap-2">
            {proof.rubric.map((row) => (
              <li key={row.code} className="text-sm">
                {t(locale, `proof.rubric.${row.code}`)} · {t(locale, "proof.agent")} {row.agent.toFixed(2)} · {t(locale, "proof.plain")} {row.baseline.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {proof.examples.length > 0 ? (
        <div className="grid gap-4">
          <h3 className="text-lg font-semibold">{t(locale, "proof.side")}</h3>
          {proof.examples.map((example) => (
            <article key={example.task} className="grid gap-3 rounded-2xl border border-line p-4">
              <h4 className="font-medium">{example.task}</h4>
              <p className="text-xs uppercase tracking-wide text-muted">{example.source === "seller_example" ? t(locale, "proof.sellerExample") : t(locale, "proof.heldOut")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-surface p-3">
                  <h5 className="text-sm font-semibold">{t(locale, "proof.agent")}</h5>
                  <p className="mt-2 text-sm leading-6">{example.agentOutput}</p>
                </div>
                <div className="rounded-xl bg-surface p-3">
                  <h5 className="text-sm font-semibold">{t(locale, "proof.plain")}</h5>
                  <p className="mt-2 text-sm leading-6">{example.baselineOutput}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
