import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { pageClass, primaryButton } from "@/components/styles";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { categoryLabel, findItem } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const active = isSupportedLocale(locale) ? locale : "en";
  const item = findItem(await loadCatalog(), slug);
  return { title: item?.name ?? t(active, "listings.title"), description: item?.pitch ?? t(active, "meta.description") };
}

export default async function ListingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const user = await currentUser();
  const item = findItem(await loadCatalog(), slug, user?.id, user?.admin ?? false);
  if (!item) {
    notFound();
  }
  const runs = t(locale, item.runsExample ? "card.exampleRuns" : "card.runs", { count: String(item.runs) });
  const rating = item.ratingCount === 0
    ? t(locale, "card.noRating")
    : t(locale, item.ratingExample ? "card.exampleRating" : "card.rating", { score: (item.ratingAverage ?? 0).toFixed(1), count: String(item.ratingCount) });
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <p className="text-sm text-muted">{categoryLabel(item.category)}{item.example ? ` · ${t(locale, "card.example")}` : ""}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{item.name}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{item.pitch}</p>
        {user && item.ownerId === user.id && item.status === "published" ? (
          <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-base leading-7">{t(locale, "listing.live", { price: formatMoney(BigInt(item.priceMinor), item.currency, locale) })}</p>
        ) : null}
        <p className="mt-3 text-sm">{rating} · {runs}</p>
        <p className="mt-2 text-sm">{item.listing.expertStatus === "verified" ? t(locale, "listings.verified") : t(locale, "listings.unverified")}</p>
        <p className="text-sm">{t(locale, "listings.uncertified")}</p>
      </header>
      {item.example ? <Notice>{t(locale, "listing.exampleNote")}</Notice> : null}
      {item.status === "draft" ? <Notice>{t(locale, "listing.draft")}</Notice> : null}
      {item.status === "suspended" || item.status === "rejected" ? <Notice tone="error">{t(locale, "listing.suspended")}</Notice> : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-8">
          <section>
            <h2 className="text-2xl font-semibold">{t(locale, "listing.about")}</h2>
            <p className="mt-3 max-w-3xl leading-7">{item.description}</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold">{t(locale, "listing.outputs")}</h2>
            <ul className="mt-3 grid gap-3">
              {item.exampleOutputs.map((output) => (
                <li key={output.title} className="rounded-2xl border border-line p-4">
                  <h3 className="font-medium">{output.title}</h3>
                  <p className="mt-2 text-sm leading-6">{output.body}</p>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold">{t(locale, "listing.reviews")}</h2>
            {item.reviews.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "listing.noReviews")}</p> : (
              <ul className="mt-3 grid gap-3">
                {item.reviews.map((review) => (
                  <li key={review.id} className="rounded-2xl border border-line p-4">
                    <p className="text-sm font-medium">{review.buyerName} · {review.rating}/5{review.example ? ` · ${t(locale, "listing.exampleReview")}` : ""}</p>
                    <p className="mt-2 text-sm leading-6">{review.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside aria-label={t(locale, "listing.levels")} className="grid h-fit gap-4">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">{t(locale, "listing.seller")}</h2>
            <p className="mt-2 font-medium">{item.sellerName}</p>
            <p className="mt-2 text-sm leading-6 text-muted">{item.sellerBio}</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold">{t(locale, "listing.levels")}</h2>
            <ul className="mt-4 grid gap-4">
              {item.tiers.map((tier) => (
                <li key={tier.serviceLevel}>
                  <article className="flex flex-col rounded-2xl border border-line bg-surface p-5">
                    <h3 className="text-xl font-semibold">{t(locale, `level.${tier.serviceLevel}`)}</h3>
                    <p className="mt-2 text-2xl">{formatMoney(BigInt(tier.priceMinor), tier.currency, locale)}</p>
                    <dl className="mt-4 grid gap-2 text-sm">
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between"><dt>{t(locale, "listing.reviewFee")}</dt><dd>{formatMoney(BigInt(tier.reviewFeeMinor), tier.currency, locale)}</dd></div>
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between"><dt>{t(locale, "listing.delivery")}</dt><dd>{t(locale, "listing.days", { count: String(tier.deliveryDays) })}</dd></div>
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between"><dt>{t(locale, "listing.revisions")}</dt><dd>{tier.includedRevisions}</dd></div>
                    </dl>
                    <p className="mt-4 text-sm leading-6 text-muted">{t(locale, `who.${tier.serviceLevel}`)}</p>
                    {item.status === "published" ? (
                      <Link className={`${primaryButton} mt-4`} href={`/${locale}/listings/${item.slug}/intake?tier=${tier.serviceLevel}`}>
                        {t(locale, "listing.choose", { level: t(locale, `level.${tier.serviceLevel}`) })}
                      </Link>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
