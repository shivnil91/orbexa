import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { RunStream } from "@/components/run-stream";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { readJob } from "@/lib/jobs";

export default async function RunPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const job = await readJob(id);
  if (!job) {
    notFound();
  }
  const transcript = job.transcript;
  const matrixReady = job.cursor >= 2 && transcript;
  const claimsReady = job.cursor >= 3 && transcript;
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-12 sm:px-8">
      <header>
        <p className="text-sm text-muted">{t(locale, `status.${job.status}`)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t(locale, "run.title")}</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">{t(locale, "run.lede")}</p>
      </header>
      <RunStream jobId={job.id} initialCursor={job.cursor} initialStatus={job.status} />
      <ol className="grid gap-2 sm:grid-cols-4" aria-label={t(locale, "run.waiting")}>
        {job.stages.map((stage, index) => {
          const done = job.cursor > index;
          const current = job.cursor === index && job.status === "running";
          return (
            <li key={stage} className="rounded-2xl border border-line bg-surface p-3" aria-current={current ? "step" : undefined}>
              <p className="text-sm text-muted">{index + 1}</p>
              <p className="font-medium">{t(locale, `stage.${stage}`)}</p>
              <p className="text-sm">{done ? t(locale, "run.done") : t(locale, "status.queued")}</p>
            </li>
          );
        })}
      </ol>
      {(job.status === "queued" || job.status === "running") && (
        <form action={`/api/jobs/${job.id}/step`} method="post">
          <input type="hidden" name="locale" value={locale} />
          <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4" type="submit">
            {t(locale, "run.next")}
          </button>
        </form>
      )}
      {matrixReady ? <EvidenceMatrix locale={locale} transcript={transcript} showClaims={Boolean(claimsReady)} /> : null}
      {job.status === "waiting_for_expert" || job.status === "waiting_for_buyer" || job.status === "accepted" ? (
        <Link className="inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-accent-foreground" href={`/${locale}/jobs/${job.id}/review`}>
          {t(locale, "run.review")}
        </Link>
      ) : null}
    </main>
  );
}
