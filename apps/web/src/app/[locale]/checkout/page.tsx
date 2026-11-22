import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { formatMoney } from "@/lib/format";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { readJob } from "@/lib/jobs";
import { stripeTestNetworkEnabled } from "@/lib/payments";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ job?: string; error?: string; notice?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale) || !query.job) {
    notFound();
  }
  const job = await readJob(query.job);
  if (!job) {
    notFound();
  }
  const total = job.priceMinor;
  const error = messageFor(locale, query.error);
  let stripeReady = false;
  try {
    stripeReady = stripeTestNetworkEnabled();
  } catch {
    stripeReady = false;
  }
  return (
    <main id="content" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-12 sm:px-8">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "checkout.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t(locale, "checkout.lede")}</p>
      </header>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-xl font-semibold">{job.title}</h2>
        <p className="mt-1 text-sm text-muted">{job.opportunityName}</p>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-4"><dt>{t(locale, "checkout.level")}</dt><dd>{t(locale, `level.${job.serviceLevel}`)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "checkout.service")}</dt><dd>{formatMoney(BigInt(job.priceMinor), job.currency, locale)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "checkout.review")}</dt><dd>{formatMoney(BigInt(job.reviewFeeMinor), job.currency, locale)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "checkout.platform")}</dt><dd>{formatMoney(BigInt(job.platformFeeMinor), job.currency, locale)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "checkout.creator")}</dt><dd>{formatMoney(BigInt(job.creatorRoyaltyMinor), job.currency, locale)}</dd></div>
          <div className="flex justify-between gap-4 text-base font-semibold"><dt>{t(locale, "checkout.total")}</dt><dd>{formatMoney(BigInt(total), job.currency, locale)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "listing.cancellation")}</dt><dd className="text-right">{t(locale, `cancel.${job.cancellationCode}`)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{t(locale, "listing.payout")}</dt><dd>{t(locale, `payout.${job.payoutRelease}`)}</dd></div>
        </dl>
        {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
        <p className="mt-4 rounded-xl bg-warning-bg p-3 text-sm leading-6 text-warning">{stripeReady || query.notice === "stripe" ? t(locale, "checkout.stripeReady") : t(locale, "checkout.simulated")}</p>
        <form className="mt-5" action={`/api/jobs/${job.id}/checkout`} method="post">
          <input type="hidden" name="locale" value={locale} />
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-accent-foreground" type="submit">
            {t(locale, "checkout.pay")}
          </button>
        </form>
      </section>
    </main>
  );
}
