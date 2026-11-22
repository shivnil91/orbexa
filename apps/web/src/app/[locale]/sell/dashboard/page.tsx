import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { pageClass } from "@/components/styles";
import { canSell, updateConnect } from "@/lib/accounts";
import { syncConnectAccount } from "@/lib/connect";
import { formatMoney } from "@/lib/format";
import { messageFor, t } from "@/lib/i18n";
import { jobStatusKey, orderSummary, sellerOrders } from "@/lib/job-access";
import { listJobs } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";
import { acceptedEarnings } from "@/lib/marketplace";
import { stripeTestNetworkEnabled, stripeTestTransport } from "@/lib/payments";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Seller dashboard" };

export default async function SellerDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/sell/dashboard`);
  if (!canSell(user.role)) redirect(`/${locale}/sell`);
  const mine = (await loadCatalog()).filter((item) => item.ownerId === user.id);
  const slugs = mine.map((item) => item.slug);
  const sellerJobs = sellerOrders(await listJobs(), user.id, slugs);
  const orders = sellerJobs.map(orderSummary);
  const earnings = acceptedEarnings(sellerJobs, user.id, slugs);
  let connect = user.connect;
  let connectError: string | undefined;
  try {
    if (stripeTestNetworkEnabled() || user.connect.accountId) {
      const synced = await syncConnectAccount({ user, transport: stripeTestTransport });
      if (synced.chargesEnabled !== connect.chargesEnabled || synced.detailsSubmitted !== connect.detailsSubmitted || synced.mode !== connect.mode) {
        await updateConnect(user.id, synced);
      }
      connect = synced;
    }
  } catch (error) {
    connect = { ...user.connect, chargesEnabled: false, detailsSubmitted: false };
    if (error instanceof Error && /live Stripe/.test(error.message)) {
      connectError = "live";
    }
  }
  const error = messageFor(locale, query.error ?? connectError);
  return (
    <main id="content" className={pageClass}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "seller.title")}</h1>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {query.notice === "simulated" ? <Notice>{t(locale, "seller.connectSimulated")}</Notice> : null}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">{t(locale, "seller.earnings")}</h2>
        <p className="mt-2 text-3xl">{formatMoney(BigInt(earnings), "USD", locale)}</p>
        <p className="mt-2 text-sm leading-6 text-muted">{t(locale, "seller.earningsNote")}</p>
      </section>
      <section className="rounded-2xl border border-line p-5">
        <h2 className="text-lg font-semibold">{t(locale, "seller.connectTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{connect.chargesEnabled ? t(locale, "seller.connectEnabled") : connect.accountId ? t(locale, "seller.connectPending") : t(locale, "seller.connectOff")}</p>
        {connect.accountId ? <p className="mt-2 text-sm">Account {connect.accountId}</p> : null}
        <form action="/api/connect" className="mt-4" method="post">
          <input name="locale" type="hidden" value={locale} />
          <SubmitButton label={t(locale, "seller.connectStart")} pendingLabel={t(locale, "pending")} />
        </form>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "seller.listings")}</h2>
        {mine.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "sell.empty")}</p> : (
          <ul className="mt-3 grid gap-2">
            {mine.map((item) => (
              <li key={item.slug}><Link className="underline" href={`/${locale}/sell/${item.slug}`}>{item.name}</Link> · {item.status}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "seller.orders")}</h2>
        {orders.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "seller.noOrders")}</p> : (
          <ul className="mt-3 grid gap-3">
            {orders.map((job) => (
              <li key={job.id} className="rounded-2xl border border-line p-4 text-sm">
                <p className="font-medium">{job.title}</p>
                <p className="mt-1 text-muted">{t(locale, jobStatusKey(job.status, job.refunded))} · {formatMoney(BigInt(job.priceMinor), job.currency, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
