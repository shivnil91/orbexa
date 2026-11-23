import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { ProofCoach } from "@/components/proof-coach";
import { ProofPanel } from "@/components/proof-panel";
import { ProofPoller } from "@/components/proof-poller";
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
        <p className="mt-3 text-sm">{rating} · {runs}</p>
        <p className="mt-2 text-sm">{t(locale, "listing.expertName", { name: item.sellerName })}</p>
        {item.proof?.status === "complete" ? <p className="mt-2 text-sm font-medium">{t(locale, "proof.beats", { wins: String(item.proof.wins), tests: String(item.proof.tests) })}{item.proof.proven ? "" : ` · ${t(locale, "proof.notProven")}`}</p> : null}
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
          <section aria-labelledby="knowledge-title">
            <h2 id="knowledge-title" className="text-2xl font-semibold">{t(locale, "knowledge.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t(locale, "knowledge.private")}</p>
            {item.knowledgeCounts.length === 0 && item.interviewCount === 0 ? <p className="mt-3 text-sm">{t(locale, "knowledge.empty")}</p> : (
              <ul className="mt-3 grid gap-2 text-sm">
                {item.knowledgeCounts.map((row) => (
                  <li key={row.kind}>{t(locale, `knowledge.${row.kind}`, { count: String(row.count) })}</li>
                ))}
                {item.interviewCount > 0 ? <li>{t(locale, "knowledge.interview", { count: String(item.interviewCount) })}</li> : null}
              </ul>
            )}
          </section>
          {item.proof ? <ProofPanel locale={locale} proof={item.proof} /> : null}
          {user && user.id === item.ownerId && item.proof?.status === "complete" && !item.example ? <ProofCoach locale={locale} proof={item.proof} slug={item.slug} /> : null}
          {item.proof && item.proof.status !== "complete" && item.proof.status !== "failed" ? <ProofPoller slug={item.slug} /> : null}
          {item.proof && (item.proof.status === "queued" || item.proof.status === "running") ? <p className="text-sm text-muted">{t(locale, "proof.running")}</p> : null}
          <section aria-labelledby="track-title">
            <h2 id="track-title" className="text-2xl font-semibold">{t(locale, "track.title")}</h2>
            {item.track.example ? <p className="mt-3 text-sm">{t(locale, "track.example")}</p> : item.track.paidJobs === 0 ? <p className="mt-3 text-sm">{t(locale, "track.empty")}</p> : (
              <ul className="mt-3 grid gap-1 text-sm">
                <li>{t(locale, "track.completed", { count: String(item.track.completedJobs) })}</li>
                <li>{t(locale, "track.acceptance", { rate: item.track.acceptanceRate == null ? "—" : `${Math.round(item.track.acceptanceRate * 100)}%` })}</li>
                <li>{t(locale, "track.revision", { rate: item.track.revisionRate == null ? "—" : `${Math.round(item.track.revisionRate * 100)}%` })}</li>
                <li>{t(locale, "track.repeat", { count: String(item.track.repeatBuyers) })}</li>
                <li>{t(locale, "track.median", { count: item.track.medianDeliveryMinutes == null ? "—" : String(Math.round(item.track.medianDeliveryMinutes)) })}</li>
                <li>{t(locale, "track.reviews", { count: String(item.track.verifiedReviews) })}</li>
              </ul>
            )}
          </section>
          <section aria-labelledby="guarantee-title" className="rounded-2xl border border-line p-4">
            <h2 id="guarantee-title" className="text-lg font-semibold">{t(locale, "guarantee.title")}</h2>
            <p className="mt-2 text-sm leading-6">{t(locale, "guarantee.body")}</p>
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
            <div className="mt-3 flex items-center gap-3">
              {item.photoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="size-12 rounded-full object-cover" src={item.photoDataUrl} />
              ) : (
                <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-surface text-sm font-semibold">{item.initials}</span>
              )}
              <p className="font-medium">{item.sellerName}</p>
            </div>
            {item.example ? <p className="mt-2 text-sm">{t(locale, "listing.exampleProfile")}</p> : null}
            {item.experience ? <p className="mt-2 text-sm leading-6">{item.experience}</p> : null}
            {item.sellerBio ? <p className="mt-2 text-sm leading-6 text-muted">{item.sellerBio}</p> : null}
            {item.links.length > 0 ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {item.links.map((link) => (
                  <li key={link.href}><a className="underline" href={link.href} rel="noreferrer">{link.label}</a></li>
                ))}
              </ul>
            ) : null}
            {item.credentials.length === 0 ? <p className="mt-2 text-sm text-muted">{t(locale, "listing.noCredential")}</p> : (
              <ul className="mt-2 grid gap-1 text-sm">
                {item.credentials.map((credential) => (
                  <li key={`${credential.title}-${credential.issuer}`}>
                    {credential.title} · {credential.issuer} · {credential.status === "verified" ? t(locale, "listing.verifiedCredential") : t(locale, "listing.selfDeclared")}
                  </li>
                ))}
              </ul>
            )}
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
                      <div className="flex flex-col gap-1 sm:flex-row sm:justify-between"><dt>{t(locale, "listing.delivery")}</dt><dd>{tier.slaHours ? t(locale, "seller.sla", { hours: String(tier.slaHours) }) : t(locale, "listing.days", { count: String(tier.deliveryDays) })}</dd></div>
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
