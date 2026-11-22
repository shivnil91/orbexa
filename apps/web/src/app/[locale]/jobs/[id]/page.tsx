import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { Notice } from "@/components/notice";
import { RunStream } from "@/components/run-stream";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { readJob } from "@/lib/jobs";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const job = await readJob(id);
  if (!job) {
    notFound();
  }
  const error = messageFor(locale, query.error);
  const transcript = job.transcript;
  const matrixReady = job.cursor >= 2 && transcript;
  const claimsReady = job.cursor >= 3 && transcript;
  return (
    <main id="content" className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <header>
        <p className="text-sm text-muted">{t(locale, `status.${job.status}`)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t(locale, "run.title")}</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">{job.transcript ? t(locale, "run.lede") : t(locale, "run.ledeGeneric")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {job.status === "checkout" ? (
        <Notice>
          {t(locale, "run.unpaid")} <Link className="underline" href={`/${locale}/checkout?job=${job.id}`}>{t(locale, "run.return")}</Link>
        </Notice>
      ) : null}
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
      {!transcript && job.paragraphs.length > 0 && job.cursor >= job.stages.length ? (
        <section>
          <h2 className="text-2xl font-semibold">{t(locale, "run.deliverable")}</h2>
          {job.paragraphs.map((paragraph) => <p key={paragraph} className="mt-3 max-w-3xl leading-7">{paragraph}</p>)}
        </section>
      ) : null}
      {job.status === "waiting_for_expert" || job.status === "waiting_for_buyer" || job.status === "accepted" ? (
        <Link className="inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-accent-foreground" href={`/${locale}/jobs/${job.id}/review`}>
          {t(locale, "run.review")}
        </Link>
      ) : null}
    </main>
  );
}
