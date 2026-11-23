import { SubmitButton } from "@/components/submit-button";
import { t } from "@/lib/i18n";
import type { PublicProof } from "@/lib/trust";

function summary(task: string): string {
  const clean = task.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}

export function ProofCoach({ locale, slug, proof }: { locale: string; slug: string; proof: PublicProof }) {
  const losses = proof.outcomes.filter((row) => row.winner === "baseline" && row.source !== "seller_example").slice(0, 5);
  const tasks = losses.map((row) => summary(row.task)).join("; ");
  return (
    <section aria-labelledby="coach-title" className="rounded-2xl border border-line bg-surface p-5">
      <h2 id="coach-title" className="text-lg font-semibold">{t(locale, "proof.coach", { wins: String(proof.wins), tests: String(proof.tests) })}</h2>
      {losses.length > 0 ? <p className="mt-2 text-sm leading-6">{t(locale, "proof.lost", { tasks })}</p> : null}
      <p className="mt-2 text-sm leading-6">{t(locale, "proof.coachAdd")}</p>
      <form action="/api/agents/proof" className="mt-4" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="slug" type="hidden" value={slug} />
        <SubmitButton label={t(locale, "proof.rerun")} pendingLabel={t(locale, "pending")} />
      </form>
    </section>
  );
}
