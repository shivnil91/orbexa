import Link from "next/link";
import { notFound } from "next/navigation";
import { listings, lowestTier } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function ListingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "listings.title")}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{t(locale, "listings.lede")}</p>
      </header>
      <ul className="grid gap-4">
        {listings.map((listing) => {
          const from = lowestTier(listing);
          return (
            <li key={listing.slug}>
              <article className="rounded-2xl border border-line bg-surface p-5">
                <p className="text-sm text-muted">{listing.vertical}</p>
                <h2 className="mt-1 text-2xl font-semibold">
                  <Link className="underline-offset-4 hover:underline" href={`/${locale}/listings/${listing.slug}`}>
                    {listing.title}
                  </Link>
                </h2>
                <p className="mt-2 max-w-2xl leading-7 text-muted">{listing.summary}</p>
                <p className="mt-4 text-lg">{t(locale, "listings.from", { price: formatMoney(BigInt(from.priceMinor), from.currency, locale) })}</p>
                <p className="mt-2 text-sm">{listing.expertStatus === "verified" ? t(locale, "listings.verified") : t(locale, "listings.unverified")}</p>
                <p className="text-sm">{t(locale, "listings.uncertified")}</p>
              </article>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
