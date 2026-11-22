import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentCard } from "@/components/agent-card";
import { primaryButton, secondaryButton } from "@/components/styles";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import type { CatalogItem } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

const SHELF = [
  "example-support-reply",
  "example-monthly-close",
  "example-scope-note",
  "example-drawing-check",
  "example-practice-plan",
  "example-ops-checklist",
];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: "Marketplace", description: t(isSupportedLocale(locale) ? locale : "en", "meta.description") };
}

function shelf(items: CatalogItem[]): CatalogItem[] {
  const published = items.filter((item) => item.status === "published" && item.category !== "tenders");
  return published
    .sort((left, right) => {
      const leftIndex = SHELF.indexOf(left.slug);
      const rightIndex = SHELF.indexOf(right.slug);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    })
    .slice(0, 6);
}

export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const jobs = shelf(await loadCatalog());
  return (
    <main id="content" className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12">
      <section className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">{t(locale, "home.eyebrow")}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{t(locale, "home.title")}</h1>
        <p className="mt-4 text-lg leading-8">{t(locale, "home.lede")}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link className={primaryButton} href={`/${locale}/get`}>{t(locale, "home.buyerDoor")}</Link>
          <Link className={secondaryButton} href={`/${locale}/earn`}>{t(locale, "home.sellerDoor")}</Link>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">{t(locale, "home.honest")}</p>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "home.shelf")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.shelfNote")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
        </ul>
      </section>
    </main>
  );
}
