import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { canSell } from "@/lib/accounts";
import { messageFor, t } from "@/lib/i18n";
import { readJob } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Expert review" };

export default async function ExpertQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { locale, id } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/sell/queue/${id}`);
  if (!canSell(user.role)) notFound();
  const job = await readJob(id);
  if (!job || job.sellerId !== user.id || job.serviceLevel !== "expert_review") notFound();
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{job.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t(locale, "sell.expertReviewHint")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {query.saved ? <Notice tone="info">{t(locale, "auth.save")}</Notice> : null}
      {job.status === "waiting_for_buyer" ? <Notice>{t(locale, "seller.release")}</Notice> : null}
      <form action={`/api/jobs/${job.id}/expert-draft`} className="grid gap-4" method="post">
        <input name="locale" type="hidden" value={locale} />
        <label className="grid gap-2 text-sm font-medium" htmlFor="draft">
          {t(locale, "seller.draft")}
          <textarea className={`${inputClass} min-h-48 py-2`} defaultValue={job.paragraphs.join("\n\n")} id="draft" name="draft" />
        </label>
        {job.status === "waiting_for_expert" ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <SubmitButton label={t(locale, "seller.saveDraft")} name="intent" pendingLabel={t(locale, "pending")} value="save" variant="secondary" />
            <SubmitButton label={t(locale, "seller.release")} name="intent" pendingLabel={t(locale, "pending")} value="release" />
          </div>
        ) : null}
      </form>
    </main>
  );
}
