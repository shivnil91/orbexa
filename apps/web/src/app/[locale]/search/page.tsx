import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass, primaryButton } from "@/components/styles";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { categoryLabel, recommend, searchesFor } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Search agents" };

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; saved?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  const q = (query.q ?? "").trim();
  const matches = q ? recommend(q, await loadCatalog()) : [];
  const saved = user ? await searchesFor(user.id) : [];
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "search.title")}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{t(locale, "search.lede")}</p>
      </header>
      <form action="/api/search" className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="post">
        <input name="locale" type="hidden" value={locale} />
        <label className="grid gap-2 text-sm font-medium" htmlFor="name">
          {t(locale, "search.name")}
          <input className={inputClass} id="name" name="name" maxLength={80} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="q">
          {t(locale, "search.need")}
          <textarea className={`${inputClass} min-h-28 py-2`} defaultValue={q} id="q" name="q" required minLength={3} />
        </label>
        <SubmitButton label={t(locale, "search.submit")} pendingLabel={t(locale, "pending")} />
      </form>
      {!user ? <Notice>{t(locale, "search.signIn")}</Notice> : null}
      {query.saved ? <Notice tone="info">{t(locale, "search.saved")}</Notice> : null}
      {q ? (
        <section>
          <h2 className="text-2xl font-semibold">{t(locale, "search.matches")}</h2>
          {matches.length === 0 ? <p className="mt-3 rounded-2xl border border-line p-5">{t(locale, "search.empty")}</p> : (
            <ol className="mt-4 grid gap-4">
              {matches.map((match, index) => (
                <li key={match.item.slug} className="rounded-2xl border border-line bg-surface p-5">
                  <p className="text-sm text-muted">{index + 1} · {categoryLabel(match.item.category)}{match.item.example ? ` · ${t(locale, "card.example")}` : ""}</p>
                  <h3 className="mt-1 text-xl font-semibold">
                    <Link className="underline-offset-4 hover:underline" href={`/${locale}/listings/${match.item.slug}`}>{match.item.name}</Link>
                  </h3>
                  <p className="mt-1 text-sm text-muted">{match.item.sellerName}</p>
                  {match.item.proof?.status === "complete" ? (
                    <p className="mt-2 text-sm"><span className={`rounded-full px-2 py-0.5 ${match.item.proof.proven ? "bg-supported-bg text-supported" : "bg-warning-bg text-warning"}`}>{match.item.proof.proven ? t(locale, "card.proof") : t(locale, "card.notProven")}</span> {t(locale, "card.beats", { wins: String(match.item.proof.wins), tests: String(match.item.proof.tests) })}</p>
                  ) : null}
                  <p className="mt-3 text-sm leading-6">{match.item.pitch}</p>
                  <p className="mt-2 text-sm">{match.reason}</p>
                  <p className="mt-2 font-medium">{t(locale, "card.from", { price: formatMoney(BigInt(match.item.priceMinor), match.item.currency, locale) })}</p>
                  <Link className={`${primaryButton} mt-4`} href={`/${locale}/listings/${match.item.slug}/intake?tier=autonomous&need=${encodeURIComponent(q)}`}>
                    {t(locale, "search.hire", { name: match.item.name })}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
      {user && saved.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold">{t(locale, "search.saved")}</h2>
          <ul className="mt-3 grid gap-2">
            {saved.map((search) => (
              <li key={search.id}><Link className="underline" href={`/${locale}/search?q=${encodeURIComponent(search.need)}`}>{search.name}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
