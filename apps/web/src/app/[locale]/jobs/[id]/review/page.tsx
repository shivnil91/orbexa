import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { t } from "@/lib/i18n";
import { readJob } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";

export default async function ReviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const job = await readJob(id);
  if (!job || !job.transcript) {
    notFound();
  }
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8">
      <header className="max-w-3xl">
        <p className="text-sm text-muted">{t(locale, `status.${job.status}`)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t(locale, "review.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t(locale, "review.lede")}</p>
        <p className="mt-2 text-sm">{t(locale, "review.noTraining")}</p>
      </header>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "review.draft")}</h2>
        {job.paragraphs.map((paragraph) => (
          <p key={paragraph} className="mt-3 max-w-3xl leading-7">{paragraph}</p>
        ))}
      </section>
      <EvidenceMatrix locale={locale} transcript={job.transcript} showClaims />
      <section>
        <h2 className="text-lg font-semibold">{t(locale, "review.downloads")}</h2>
        <p className="mt-2 text-sm text-muted">{t(locale, "review.fixtureFiles")}</p>
        <ul className="mt-3 flex flex-col gap-2 sm:flex-row">
          {job.downloads.map((file) => (
            <li key={file.code}>
              <a className="inline-flex min-h-11 items-center underline" href={file.href}>
                {file.code === "bid_docx" ? t(locale, "review.docx") : t(locale, "review.xlsx")}
              </a>
            </li>
          ))}
        </ul>
      </section>
      {job.status === "waiting_for_expert" ? (
        <form action={`/api/jobs/${job.id}/signal`} method="post" className="rounded-2xl border border-line bg-surface p-5">
          <input type="hidden" name="locale" value={locale} />
          <p className="text-sm leading-6 text-muted">{t(locale, "review.signal")}</p>
          <button className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-accent-foreground" type="submit">
            {t(locale, "review.expert")}
          </button>
        </form>
      ) : null}
      <section className="grid gap-4 rounded-2xl border border-line p-5">
        <h2 className="text-lg font-semibold">{t(locale, "review.recorded")}</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <form action={`/api/jobs/${job.id}/feedback`} method="post">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="kind" value="buyer_approve" />
            <button className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-accent-foreground" type="submit">{t(locale, "review.accept")}</button>
          </form>
          <form action={`/api/jobs/${job.id}/feedback`} method="post" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="kind" value="buyer_edit" />
            <label className="grid gap-1 text-sm" htmlFor="editDistance">
              {t(locale, "review.editDistance")}
              <input id="editDistance" name="editDistance" type="number" min={0} defaultValue={0} className="min-h-11 rounded-xl border border-line px-3" />
            </label>
            <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">{t(locale, "review.edit")}</button>
          </form>
          <form action={`/api/jobs/${job.id}/feedback`} method="post">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="kind" value="buyer_reject" />
            <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">{t(locale, "review.reject")}</button>
          </form>
        </div>
        <p className="text-sm text-muted">{t(locale, "review.editHelp")}</p>
        <form action={`/api/jobs/${job.id}/feedback`} method="post" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="kind" value="expert_rating" />
          <label className="grid gap-1 text-sm" htmlFor="rating">
            {t(locale, "review.rating")}
            <select id="rating" name="rating" className="min-h-11 rounded-xl border border-line bg-background px-3" defaultValue="3">
              {[1, 2, 3, 4, 5].map((score) => (
                <option key={score} value={score}>{score}</option>
              ))}
            </select>
          </label>
          <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">{t(locale, "review.rating")}</button>
        </form>
        <div>
          <h3 className="text-sm font-medium">{t(locale, "review.outcome")}</h3>
          <p className="mt-1 text-sm text-muted">{t(locale, "review.outcomeHelp")}</p>
          <div className="mt-2 flex gap-2">
            <form action={`/api/jobs/${job.id}/feedback`} method="post">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="kind" value="tender_win" />
              <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">{t(locale, "review.win")}</button>
            </form>
            <form action={`/api/jobs/${job.id}/feedback`} method="post">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="kind" value="tender_loss" />
              <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">{t(locale, "review.loss")}</button>
            </form>
          </div>
        </div>
        {job.feedback.length > 0 ? (
          <ul className="text-sm">
            {job.feedback.map((item) => (
              <li key={`${item.kind}-${item.at}`}>{item.kind} · {item.reward}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <form action={`/api/jobs/${job.id}/consent`} method="post" className="rounded-2xl bg-warning-bg p-5 text-warning">
        <input type="hidden" name="locale" value={locale} />
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6" htmlFor="consent">
          <input id="consent" name="granted" type="checkbox" value="yes" defaultChecked={job.trainingConsent} className="mt-1 size-5" />
          <span>{t(locale, "review.consent")}</span>
        </label>
        <p className="mt-2 text-sm leading-6">{t(locale, "review.consentHelp")}</p>
        <button className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-accent-foreground" type="submit">
          {t(locale, "review.consentSave")}
        </button>
      </form>
    </main>
  );
}
