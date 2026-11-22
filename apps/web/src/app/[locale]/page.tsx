import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentCard } from "@/components/agent-card";
import { primaryButton, secondaryButton } from "@/components/styles";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { CATEGORIES } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: "Marketplace", description: t(isSupportedLocale(locale) ? locale : "en", "meta.description") };
}

export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const published = (await loadCatalog()).filter((item) => item.status === "published");
  const featured = published.filter((item) => item.featured).slice(0, 3);
  const trending = [...published].sort((left, right) => right.runs - left.runs).slice(0, 4);
  const newest = [...published].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 4);
  return (
    <main id="content" className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-12 px-4 py-8 sm:px-8 sm:py-12">
      <section className="max-w-3xl">
        <p className="text-sm font-medium text-muted">{t(locale, "home.eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{t(locale, "home.title")}</h1>
        <p className="mt-4 text-lg leading-8 text-muted">{t(locale, "home.lede")}</p>
        <form action={`/${locale}/search`} className="mt-6 flex flex-col gap-2 sm:flex-row" method="get">
          <label className="sr-only" htmlFor="q">{t(locale, "home.searchLabel")}</label>
          <input className="min-h-12 w-full flex-1 rounded-full border border-line bg-surface px-4 text-base" id="q" name="q" placeholder={t(locale, "home.searchPlaceholder")} />
          <button className={primaryButton} type="submit">{t(locale, "home.searchSubmit")}</button>
        </form>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link className={primaryButton} href={`/${locale}/sell`}>{t(locale, "home.primary")}</Link>
          <Link className={secondaryButton} href={`/${locale}/search`}>{t(locale, "home.secondary")}</Link>
        </div>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "home.categories")}</h2>
        <p className="mt-2 text-sm text-muted">{t(locale, "home.categoriesNote")}</p>
        <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {CATEGORIES.map((category) => (
            <li key={category.code}>
              <Link className="block h-full rounded-2xl border border-line bg-surface p-4 hover:border-accent" href={`/${locale}/listings?category=${category.code}`}>
                <span className="font-medium">{t(locale, `category.${category.code}`)}</span>
                <span className="mt-2 block text-sm leading-6 text-muted">{t(locale, `category.${category.code}.body`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "home.featured")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.featuredNote")}</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
        </ul>
      </section>
      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-2xl font-semibold">{t(locale, "home.trending")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{t(locale, "home.trendingNote")}</p>
          <ul className="mt-4 grid gap-4">
            {trending.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
          </ul>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">{t(locale, "home.new")}</h2>
          <ul className="mt-4 grid gap-4">
            {newest.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
          </ul>
        </section>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        {(["home.step1", "home.step2", "home.step3"] as const).map((key) => (
          <article key={key} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-medium">{t(locale, `${key}.title`)}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t(locale, `${key}.body`)}</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="text-lg font-medium">{t(locale, "home.packTitle")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.packBody")}</p>
        <Link className="mt-4 inline-flex min-h-11 items-center underline" href={`/${locale}/listings/hospital-beds`}>{t(locale, "home.packLink")}</Link>
      </section>
    </main>
  );
}
