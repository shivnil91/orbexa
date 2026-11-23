import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { PublishForm } from "@/components/publish-form";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { CATEGORIES, categoryLabel, draftFromSkill } from "@/lib/marketplace";
import { currentUser } from "@/server/session";

function earningsFrom(priceRaw: string): { job: string; keep: string; fee: string } | null {
  const dollars = Number(priceRaw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const keep = Math.round(dollars * 80) / 100;
  const fee = Math.round(dollars * 20) / 100;
  const show = (value: number) => Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
  return { job: show(dollars), keep: show(keep), fee: show(fee) };
}

function EarningsSplit({ priceRaw, note }: { priceRaw: string; note: string }) {
  const split = earningsFrom(priceRaw);
  if (!split) return <p className="mt-4 text-sm leading-6">{note}</p>;
  return (
    <section className="mt-4 rounded-3xl border border-line bg-surface p-5" aria-label="What you keep">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">A {split.job} job</p>
      <p className="mt-3 font-display text-4xl font-semibold">You keep {split.keep}</p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        <span className="w-4/5 bg-accent" />
        <span className="w-1/5 bg-line" />
      </div>
      <p className="mt-3 text-sm leading-6">{note}</p>
      <p className="mt-1 text-sm text-muted">On {split.job}, Orbexa keeps {split.fee}.</p>
    </section>
  );
}

export const metadata: Metadata = { title: "Earn from your skills" };

export default async function EarnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ skill?: string; error?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const skill = (query.skill ?? "").trim();
  const draft = skill ? draftFromSkill(skill) : null;
  const user = await currentUser();
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <p className="text-sm font-semibold text-muted">{t(locale, "earn.step", { step: draft ? "2" : "1" })}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t(locale, "sell.title")}</h1>
        <p className="mt-3 text-lg leading-8">{t(locale, "sell.lede")}</p>
        <p className="text-sm leading-6"><a className="underline" href={`/${locale}/studio`}>Build a specialist agent in Expert Agent Studio</a></p>
        {draft ? <EarningsSplit priceRaw={draft.priceRaw} note={t(locale, "earn.earnings")} /> : <p className="mt-4 text-sm leading-6">{t(locale, "earn.earnings")}</p>}
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {skill && !draft ? <Notice tone="error">{t(locale, "earn.short")}</Notice> : null}
      {!draft ? (
        <form action={`/${locale}/earn`} className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="get">
          <label className="grid gap-2 text-base font-medium" htmlFor="skill">
            {t(locale, "sell.title")}
            <textarea className={`${inputClass} min-h-32 py-3`} id="skill" name="skill" required minLength={12} maxLength={500} placeholder={t(locale, "earn.placeholder")} defaultValue={skill} />
          </label>
          <SubmitButton label={t(locale, "earn.draft")} pendingLabel={t(locale, "pending")} />
        </form>
      ) : (
        <PublishForm
          categories={CATEGORIES.map((item) => ({ code: item.code, label: categoryLabel(item.code) }))}
          draft={draft}
          labels={{
            previewTitle: t(locale, "earn.previewTitle"),
            previewNote: t(locale, "earn.previewNote"),
            drafted: t(locale, "earn.drafted"),
            turnaround: t(locale, "home.turnaround"),
            sample: t(locale, "get.sample"),
            category: t(locale, "earn.category"),
            name: t(locale, "earn.titleField"),
            pitch: t(locale, "earn.pitchField"),
            instructions: t(locale, "earn.instructionsField"),
            price: t(locale, "earn.priceField"),
            account: t(locale, "earn.account"),
            yourName: t(locale, "auth.name"),
            email: t(locale, "auth.email"),
            password: t(locale, "auth.password"),
            publish: t(locale, "sell.publish"),
            pending: t(locale, "pending"),
          }}
          locale={locale}
          signedIn={Boolean(user)}
          skill={skill}
        />
      )}
    </main>
  );
}
