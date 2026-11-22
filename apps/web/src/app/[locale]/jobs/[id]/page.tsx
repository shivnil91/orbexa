import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DraftActions, DraftPoll } from "@/components/draft-tools";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { Notice } from "@/components/notice";
import { RunStream } from "@/components/run-stream";
import { primaryButton } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { canMutateJob, jobReadDecision, jobStatusKey } from "@/lib/job-access";
import { isSupportedLocale } from "@/lib/locale";
import { readJob } from "@/lib/jobs";
import { currentUser } from "@/server/session";

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
  const user = await currentUser();
  const decision = jobReadDecision(job.tenantId, user);
  if (decision === "sign-in") {
    redirect(`/${locale}/sign-in?next=/${locale}/jobs/${job.id}`);
  }
  if (decision === "hide") {
    notFound();
  }
  const allowMutate = canMutateJob(job.tenantId, user);
  const error = messageFor(locale, query.error);
  const transcript = job.transcript;
  const ready = !transcript && job.paragraphs.length > 0 && job.cursor >= job.stages.length;
  const waitingOnModel = Boolean(job.modelDelivery) && job.paragraphs.length === 0 && !job.refunded && job.status === "running";
  const draftText = job.paragraphs.join("\n\n");
  const matrixReady = job.cursor >= 2 && transcript;
  const claimsReady = job.cursor >= 3 && transcript;
  return (
    <main id="content" className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <header>
        <p className="text-sm font-medium text-muted">{t(locale, jobStatusKey(job.status, job.refunded))}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t(locale, "run.title")}</h1>
        <p className="mt-3 text-lg leading-8">{ready ? t(locale, "run.ready") : transcript ? t(locale, "run.lede") : t(locale, "run.ledeGeneric")}</p>
        {ready ? <p className="mt-2 text-sm leading-6 text-muted">{t(locale, "run.honest")}</p> : null}
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {job.status === "checkout" ? (
        <Notice>
          {t(locale, "run.unpaid")} <Link className="underline" href={`/${locale}/checkout?job=${job.id}`}>{t(locale, "run.return")}</Link>
        </Notice>
      ) : null}
      {job.refunded && job.modelError ? (
        <div className="grid gap-3">
          <Notice tone="error">{t(locale, "run.failed")}</Notice>
          <p className="text-sm leading-6">{t(locale, "run.refunded")}</p>
        </div>
      ) : null}
      {waitingOnModel ? <DraftPoll failed={t(locale, "run.failed")} jobId={job.id} pending={t(locale, "run.working")} /> : null}
      {ready ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">{job.title}</h2>
          {job.paragraphs.map((paragraph) => <p key={paragraph} className="mt-3 leading-7">{paragraph}</p>)}
          <div className="mt-5">
            <DraftActions filename={`${job.title.slice(0, 40).replace(/[^\w.-]+/g, "-") || "draft"}.txt`} text={draftText} />
          </div>
        </section>
      ) : (
        <>
          <RunStream jobId={job.id} initialCursor={job.cursor} initialStatus={job.status} />
          <ol className="grid gap-2 sm:grid-cols-4" aria-label={t(locale, "run.waiting")}>
            {job.stages.map((stage, index) => {
              const done = job.cursor > index;
              const current = job.cursor === index && job.status === "running";
              return (
                <li key={stage} className="rounded-2xl border border-line bg-surface p-3" aria-current={current ? "step" : undefined}>
                  <p className="text-sm text-muted">{index + 1}</p>
                  <p className="font-medium">{t(locale, `stage.${stage}`)}</p>
                  <p className="text-sm">{done ? t(locale, "run.done") : t(locale, "run.queued")}</p>
                </li>
              );
            })}
          </ol>
          {allowMutate && (job.status === "queued" || job.status === "running") ? (
            <form action={`/api/jobs/${job.id}/step`} method="post">
              <input type="hidden" name="locale" value={locale} />
              <button className="inline-flex min-h-12 items-center rounded-full border border-line px-4" type="submit">
                {t(locale, "run.next")}
              </button>
            </form>
          ) : null}
          {matrixReady ? <EvidenceMatrix locale={locale} transcript={transcript} showClaims={Boolean(claimsReady)} /> : null}
          {!transcript && job.paragraphs.length > 0 ? (
            <section>
              <h2 className="text-2xl font-semibold">{t(locale, "run.deliverable")}</h2>
              {job.paragraphs.map((paragraph) => <p key={paragraph} className="mt-3 leading-7">{paragraph}</p>)}
            </section>
          ) : null}
        </>
      )}
      {allowMutate && job.status === "waiting_for_buyer" ? (
        <form action={`/api/jobs/${job.id}/feedback`} method="post">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="kind" value="buyer_approve" />
          <button className={primaryButton} type="submit">{t(locale, "review.accept")}</button>
        </form>
      ) : null}
      {job.status === "waiting_for_expert" || job.status === "waiting_for_buyer" || job.status === "accepted" ? (
        <Link className="inline-flex min-h-12 w-fit items-center font-semibold underline" href={`/${locale}/jobs/${job.id}/review`}>
          {t(locale, "run.review")}
        </Link>
      ) : null}
    </main>
  );
}
