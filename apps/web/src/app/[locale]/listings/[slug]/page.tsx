import Link from "next/link";
import { notFound } from "next/navigation";
import { listingBySlug, packFor } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export default async function ListingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const listing = listingBySlug(slug);
  if (!listing) {
    notFound();
  }
  const pack = packFor(listing);
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8">
      <header className="max-w-3xl">
        <p className="text-sm text-muted">{listing.vertical}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{listing.title}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{listing.summary}</p>
        <p className="mt-3 text-sm">{listing.expertStatus === "verified" ? t(locale, "listings.verified") : t(locale, "listings.unverified")}</p>
        <p className="text-sm">{t(locale, "listings.uncertified")}</p>
        <p className="mt-3 text-sm text-muted">{t(locale, "home.memory.body")}</p>
      </header>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "listing.levels")}</h2>
        <ul className="mt-4 grid gap-4 lg:grid-cols-3">
          {listing.tiers.map((tier) => (
            <li key={tier.serviceLevel}>
              <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
                <h3 className="text-xl font-semibold">{t(locale, `level.${tier.serviceLevel}`)}</h3>
                <p className="mt-2 text-2xl">{formatMoney(BigInt(tier.priceMinor), tier.currency, locale)}</p>
                <dl className="mt-4 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.reviewFee")}</dt><dd>{formatMoney(BigInt(tier.reviewFeeMinor), tier.currency, locale)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.delivery")}</dt><dd>{t(locale, "listing.days", { count: String(tier.deliveryDays) })}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.revisions")}</dt><dd>{tier.includedRevisions}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.platform")}</dt><dd>{t(locale, "bps", { value: String(tier.platformFeeBps) })}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.cancellation")}</dt><dd className="text-right">{t(locale, `cancel.${tier.cancellationCode}`)}</dd></div>
                  <div className="flex justify-between gap-3"><dt>{t(locale, "listing.payout")}</dt><dd className="text-right">{t(locale, `payout.${tier.payoutRelease}`)}</dd></div>
                </dl>
                <p className="mt-4 text-sm leading-6 text-muted">{t(locale, `who.${tier.serviceLevel}`)}</p>
                <Link className="mt-auto inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-center text-accent-foreground" href={`/${locale}/listings/${listing.slug}/intake?tier=${tier.serviceLevel}`}>
                  {t(locale, "listing.choose", { level: t(locale, `level.${tier.serviceLevel}`) })}
                </Link>
              </article>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted">{pack.workflow.map((stage) => t(locale, `stage.${stage}`)).join(" · ")}</p>
    </main>
  );
}
