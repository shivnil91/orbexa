import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentCard } from "@/components/agent-card";
import { Notice } from "@/components/notice";
import { inputClass, pageClass, primaryButton, secondaryButton } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { browseCatalog, CATEGORIES, parseBrowseQuery } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

export const metadata: Metadata = { title: "Browse agents" };

function hrefFor(locale: string, query: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/${locale}/listings?${params.toString()}`;
}

export default async function ListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  await connection();
  const raw = await searchParams;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const parsed = parseBrowseQuery(raw);
  const page = browseCatalog(await loadCatalog(), parsed);
  const error = messageFor(locale, raw.error);
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "listings.title")}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{t(locale, "listings.lede")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {parsed.priceError ? <Notice tone="error">{t(locale, "form.price")}</Notice> : null}
      <form action={`/${locale}/listings`} className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3" method="get">
        <label className="grid gap-1 text-sm font-medium" htmlFor="q">
          {t(locale, "listings.query")}
          <input className={inputClass} defaultValue={parsed.q ?? ""} id="q" name="q" />
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="category">
          {t(locale, "listings.category")}
          <select className={inputClass} defaultValue={parsed.category ?? ""} id="category" name="category">
            <option value="">{t(locale, "listings.any")}</option>
            {CATEGORIES.map((category) => <option key={category.code} value={category.code}>{t(locale, `category.${category.code}`)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="sort">
          {t(locale, "listings.sort")}
          <select className={inputClass} defaultValue={parsed.sort ?? "newest"} id="sort" name="sort">
            {(["recommended", "newest", "price_asc", "price_desc", "rating", "runs"] as const).map((sort) => (
              <option key={sort} value={sort}>{t(locale, `sort.${sort}`)}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="minPrice">
          {t(locale, "listings.minPrice")}
          <input className={inputClass} defaultValue={raw.minPrice ?? ""} id="minPrice" inputMode="decimal" name="minPrice" />
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="maxPrice">
          {t(locale, "listings.maxPrice")}
          <input className={inputClass} defaultValue={raw.maxPrice ?? ""} id="maxPrice" inputMode="decimal" name="maxPrice" />
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="minRating">
          {t(locale, "listings.minRating")}
          <select className={inputClass} defaultValue={parsed.minRating ? String(parsed.minRating) : ""} id="minRating" name="minRating">
            <option value="">{t(locale, "listings.any")}</option>
            <option value="3">{t(locale, "rating.3")}</option>
            <option value="4">{t(locale, "rating.4")}</option>
            <option value="5">{t(locale, "rating.5")}</option>
          </select>
        </label>
        <button className={primaryButton} type="submit">{t(locale, "listings.apply")}</button>
      </form>
      <h2 className="text-lg font-medium">{t(locale, "listings.results", { count: String(page.total) })}</h2>
      {page.items.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-5">{t(locale, "listings.empty")}</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.items.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
        </ul>
      )}
      <nav aria-label={t(locale, "listings.page", { page: String(page.page), pages: String(page.pages) })} className="flex flex-wrap items-center gap-3">
        {page.page > 1 ? <Link className={secondaryButton} href={hrefFor(locale, raw, page.page - 1)}>{t(locale, "listings.previous")}</Link> : <span className="text-sm text-muted">{t(locale, "listings.previous")}</span>}
        <p className="text-sm">{t(locale, "listings.page", { page: String(page.page), pages: String(page.pages) })}</p>
        {page.page < page.pages ? <Link className={secondaryButton} href={hrefFor(locale, raw, page.page + 1)}>{t(locale, "listings.next")}</Link> : <span className="text-sm text-muted">{t(locale, "listings.next")}</span>}
      </nav>
    </main>
  );
}
