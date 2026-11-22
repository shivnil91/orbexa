import Link from "next/link";
import { notFound } from "next/navigation";
import { listings, lowestTier } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const listing = listings[0];
  const from = lowestTier(listing);
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-12 sm:px-8">
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-muted">{t(locale, "home.eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{t(locale, "home.title")}</h1>
        <p className="mt-4 text-lg leading-8 text-muted">{t(locale, "home.lede")}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-accent-foreground" href={`/${locale}/listings/${listing.slug}`}>
            {t(locale, "home.primary")}
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5" href={`/${locale}/dashboard`}>
            {t(locale, "home.secondary")}
          </Link>
        </div>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        {(["home.step1", "home.step2", "home.step3"] as const).map((key) => (
          <article key={key} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-medium">{t(locale, `${key}.title`)}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t(locale, `${key}.body`)}</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="text-lg font-medium">{t(locale, "home.memory.title")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{t(locale, "home.memory.body")}</p>
        <p className="mt-4 text-sm">
          {listing.title}: {t(locale, "listings.from", { price: formatMoney(BigInt(from.priceMinor), from.currency, locale) })}
        </p>
      </section>
    </main>
  );
}
