import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { messageFor } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { EXAMPLE_PANEL_BADGE, INDICATIVE_LABEL } from "@/lib/studio-types";
import { readRun } from "@/lib/studio-store";
import { visibleQuestions } from "@/lib/studio-intake";
import { currentUser } from "@/server/session";

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string; runId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, slug, runId } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user) notFound();
  const loaded = await readRun(user.id, runId);
  if (!loaded || loaded.run.slug !== slug) notFound();
  const questions = visibleQuestions(loaded.config.intake, loaded.run.answers);
  const missing = questions.filter((question) => question.required && !(loaded.run.answers[question.id] ?? "").trim());
  const error = messageFor(locale, query.error);
  const report = loaded.run.report;
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Intake</h1>
        <p className="mt-3 text-sm leading-6">Demo payment recorded for this hire. No card is charged. You keep the report, the pack, and the checklist.</p>
        {loaded.run.exampleData ? <p className="mt-3 text-sm font-semibold">{EXAMPLE_PANEL_BADGE}</p> : null}
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm"><Link className="underline" href={`/${locale}/share/${loaded.run.shareToken}`}>Share this intake with your client</Link></p>
      <form action="/api/studio/run" className="grid gap-4" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="intent" type="hidden" value="answers" />
        <input name="slug" type="hidden" value={slug} />
        <input name="runId" type="hidden" value={runId} />
        {questions.map((question) => (
          <label key={question.id} className="grid gap-2 text-sm font-medium" htmlFor={question.id}>
            {question.prompt}{question.required ? " (required)" : ""}
            <span className="font-normal text-muted">Why it matters: {question.why}</span>
            {question.kind === "choice" ? (
              <select className={inputClass} defaultValue={loaded.run.answers[question.id] ?? ""} id={question.id} name={`answer_${question.id}`} required={question.required}>
                <option value="">Choose</option>
                {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input className={inputClass} defaultValue={loaded.run.answers[question.id] ?? ""} id={question.id} name={`answer_${question.id}`} required={question.required} inputMode={question.kind === "number" ? "decimal" : "text"} />
            )}
          </label>
        ))}
        <SubmitButton label="Save answers" pendingLabel="Saving" variant="secondary" />
      </form>
      {missing.length === 0 ? (
        <form action="/api/studio/run" className="grid gap-3" method="post">
          <input name="locale" type="hidden" value={locale} />
          <input name="intent" type="hidden" value="complete" />
          <input name="slug" type="hidden" value={slug} />
          <input name="runId" type="hidden" value={runId} />
          <label className="grid gap-2 text-sm font-medium" htmlFor="csv">Bank or Xero CSV
            <input className="min-h-11 text-sm" id="csv" name="csv" type="file" accept=".csv,text/csv" />
          </label>
          <SubmitButton label="Prepare the report" pendingLabel="Preparing" />
        </form>
      ) : <p className="text-sm">Answer the required questions, including any that appear after you save.</p>}
      {report ? (
        <section className="grid gap-4" aria-labelledby="report-title">
          <h2 id="report-title" className="text-2xl font-semibold">Funding options report</h2>
          {report.fundingReport.map((line) => <p key={line} className="text-sm leading-6">{line}</p>)}
          <h3 className="text-xl font-semibold">Lender-ready pack</h3>
          {report.lenderPack.map((line) => <p key={line} className="text-sm leading-6">{line}</p>)}
          <h3 className="text-xl font-semibold">Note for the accountant</h3>
          {report.clientSummary.map((line) => <p key={line} className="text-sm leading-6">{line}</p>)}
          <h3 className="text-xl font-semibold">Decision trail</h3>
          <p className="text-sm">Citation coverage {Math.round(report.coverage * 100)}%.</p>
          <ul className="grid gap-2 text-sm">
            {report.claims.map((claim) => (
              <li key={claim.id}>{claim.text} · {claim.source.type === "model" ? "model reasoning" : claim.source.id}</li>
            ))}
          </ul>
          <p className="text-sm font-semibold">{INDICATIVE_LABEL}</p>
          <form action="/api/studio/run" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="intent" type="hidden" value="broker" />
            <input name="slug" type="hidden" value={slug} />
            <input name="runId" type="hidden" value={runId} />
            <SubmitButton label={loaded.run.brokerRequested ? "Broker requested" : "Request the broker"} pendingLabel="Sending" />
          </form>
          {loaded.run.brokerRequested ? <p className="text-sm">The broker has the lead.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
