import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentCard } from "@/components/agent-card";
import { JobMark, laneForCategory } from "@/components/job-mark";
import { primaryButton, secondaryButton } from "@/components/styles";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import type { CatalogItem } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

const LANES = [
  { id: "all", label: "All jobs" },
  { id: "replies", label: "Replies" },
  { id: "books", label: "Bookkeeping" },
  { id: "plans", label: "Plans & checks" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: "Marketplace", description: t(isSupportedLocale(locale) ? locale : "en", "meta.description") };
}

function shelf(items: CatalogItem[], lane: string): CatalogItem[] {
  return items
    .filter((item) => item.status === "published" && laneForCategory(item.category))
    .filter((item) => lane === "all" || laneForCategory(item.category) === lane)
    .sort((left, right) => left.priceMinor - right.priceMinor || left.name.localeCompare(right.name));
}

export default async function LocaleHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ lane?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const lane = LANES.some((item) => item.id === query.lane) ? query.lane ?? "all" : "all";
  const jobs = shelf(await loadCatalog(), lane);
  return (
    <main id="content" className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-10 px-4 py-8 sm:px-8 sm:py-12">
      <section className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">{t(locale, "home.eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{t(locale, "home.title")}</h1>
        <p className="mt-4 text-lg leading-8">{t(locale, "home.lede")}</p>
        <p className="mt-3 text-lg leading-8">{t(locale, "home.promise")}</p>
        <p className="mt-2 leading-7">{t(locale, "home.sellerLine")}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link className={primaryButton} href={`/${locale}/get`}>{t(locale, "home.buyerDoor")}</Link>
          <Link className={secondaryButton} href={`/${locale}/earn`}>{t(locale, "home.sellerDoor")}</Link>
        </div>
      </section>
      <section aria-label={t(locale, "home.how")}>
        <h2 className="text-2xl font-semibold">{t(locale, "home.how")}</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {(["replies", "books", "plans"] as const).map((step, index) => (
            <li key={step} className="rounded-3xl border border-line bg-surface p-4">
              <JobMark lane={step} />
              <h3 className="mt-3 text-lg font-semibold">{t(locale, `home.how${index + 1}`)}</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{t(locale, `home.how${index + 1}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid gap-4" aria-labelledby="why-title">
        <h2 id="why-title" className="text-2xl font-semibold">{t(locale, "home.whyTitle")}</h2>
        <p className="max-w-3xl leading-7 text-muted">{t(locale, "home.whyBody")}</p>
        <p className="text-sm text-muted">{t(locale, "home.whyExample")}</p>
      </section>
      <section aria-labelledby="beach-title">
        <h2 id="beach-title" className="text-2xl font-semibold">{t(locale, "home.beachTitle")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.beachBody")}</p>
        <ul className="mt-4 grid gap-3 lg:grid-cols-3">
          {(["home.beach1", "home.beach2", "home.beach3"] as const).map((key) => (
            <li key={key} className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="font-medium">{t(locale, `${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{t(locale, `${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold">{t(locale, "home.shelf")}</h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.shelfNote")}</p>
        <ul className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {LANES.map((item) => {
            const active = item.id === lane;
            return (
              <li key={item.id}>
                <Link
                  className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${active ? "border-accent bg-accent text-accent-foreground" : "border-line bg-surface"}`}
                  href={item.id === "all" ? `/${locale}` : `/${locale}?lane=${item.id}`}
                  aria-current={active ? "true" : undefined}
                >
                  {item.id !== "all" ? <JobMark lane={item.id} size="sm" /> : null}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((item) => <li key={item.slug}><AgentCard item={item} locale={locale} /></li>)}
        </ul>
      </section>
    </main>
  );
}
