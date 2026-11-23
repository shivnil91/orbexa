import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { formatMoney } from "@/lib/format";
import { messageFor, t } from "@/lib/i18n";
import { liveProven } from "@/lib/trust";
import { isSupportedLocale } from "@/lib/locale";
import { recommend } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

export const metadata: Metadata = { title: "Get something done" };

export default async function GetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ need?: string; error?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const need = (query.need ?? "").trim();
  const matches = need ? recommend(need, await loadCatalog()).slice(0, 3) : [];
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-muted">{t(locale, "get.step", { step: need ? "2" : "1" })}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{need ? t(locale, "get.matches") : t(locale, "get.title")}</h1>
        <p className="mt-3 text-lg leading-8">{t(locale, "get.lede")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!need ? (
        <form action={`/${locale}/get`} className="grid max-w-3xl gap-4 rounded-2xl border border-line bg-surface p-5" method="get">
          <label className="grid gap-2 text-base font-medium" htmlFor="need">
            {t(locale, "get.title")}
            <textarea className={`${inputClass} min-h-32 py-3`} id="need" name="need" required minLength={3} maxLength={500} placeholder={t(locale, "get.placeholder")} />
          </label>
          <SubmitButton label={t(locale, "get.submit")} pendingLabel={t(locale, "pending")} />
        </form>
      ) : (
        <section className="grid gap-4">
          <p><Link className="inline-flex min-h-12 items-center text-base underline" href={`/${locale}/get`}>{t(locale, "get.change")}</Link></p>
          {matches.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-xl font-semibold">{t(locale, "get.emptyTitle")}</h2>
              <p className="mt-2 leading-7">{t(locale, "get.emptyBody")}</p>
              <Link className="mt-4 inline-flex min-h-12 items-center text-base font-semibold underline" href={`/${locale}/get`}>{t(locale, "get.change")}</Link>
            </div>
          ) : (
            <>
            <p className="text-sm leading-6 text-muted">{t(locale, "get.ranked")}</p>
            <ol className="grid gap-4">
              {matches.map((match, index) => {
                const price = formatMoney(BigInt(match.item.priceMinor), match.item.currency, locale);
                const sample = match.item.exampleOutputs[0];
                const rating = match.item.ratingCount === 0
                  ? t(locale, "card.noRating")
                  : t(locale, match.item.ratingExample ? "card.exampleRating" : "card.rating", {
                      score: (match.item.ratingAverage ?? 0).toFixed(1),
                      count: String(match.item.ratingCount),
                    });
                return (
                  <li key={match.item.slug}>
                    <article className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
                      <p className="text-sm font-medium text-muted">{index + 1}{match.item.example ? ` · ${t(locale, "card.example")}` : ""}</p>
                      <h2 className="text-2xl font-semibold">{match.item.name}</h2>
                      <p className="text-2xl font-semibold">{price}</p>
                      {match.item.proof?.status === "complete" ? (
                        <p className="text-sm font-medium">
                          <span className={`rounded-full px-2 py-0.5 ${liveProven(match.item.proof) ? "bg-supported-bg text-supported" : "bg-warning-bg text-warning"}`}>
                            {liveProven(match.item.proof) ? t(locale, "card.proof") : t(locale, "card.notProven")}
                          </span>
                          {" "}
                          {t(locale, "card.beats", { wins: String(match.item.proof.wins), tests: String(match.item.proof.tests) })}
                        </p>
                      ) : null}
                      {match.item.proof?.status === "queued" || match.item.proof?.status === "running" ? <p className="text-sm font-medium">{t(locale, "card.proofRunning")}</p> : null}
                      <p className="font-medium">{t(locale, "home.turnaround")}</p>
                      <p className="text-sm">{rating}</p>
                      {sample ? (
                        <div className="rounded-xl border border-line p-4">
                          <h3 className="text-base font-semibold">{t(locale, "get.sample")}</h3>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{sample.body}</p>
                        </div>
                      ) : null}
                      <form action="/api/jobs" method="post">
                        <input name="locale" type="hidden" value={locale} />
                        <input name="slug" type="hidden" value={match.item.slug} />
                        <input name="tier" type="hidden" value="autonomous" />
                        <input name="need" type="hidden" value={need} />
                        <input name="pay" type="hidden" value="1" />
                        <SubmitButton label={t(locale, "get.pay", { price })} pendingLabel={t(locale, "pending")} />
                      </form>
                    </article>
                  </li>
                );
              })}
            </ol>
            </>
          )}
        </section>
      )}
    </main>
  );
}
