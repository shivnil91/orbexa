import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { pageClass } from "@/components/styles";
import { canSell } from "@/lib/accounts";
import { formatMoney } from "@/lib/format";
import { messageFor, t } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";
import { acceptedEarnings } from "@/lib/marketplace";
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
  const orders = (await listJobs()).filter((job) => job.sellerId === user.id || slugs.includes(job.listingSlug));
  const earnings = acceptedEarnings(orders, user.id, slugs);
  const error = messageFor(locale, query.error);
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
        <p className="mt-2 text-sm leading-6 text-muted">{user.connect.accountId ? t(locale, "seller.connectReady") : t(locale, "seller.connectOff")}</p>
        {user.connect.accountId ? <p className="mt-2 text-sm">Account {user.connect.accountId}</p> : null}
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
                <p className="mt-1 text-muted">{t(locale, `status.${job.status}`)} · {formatMoney(BigInt(job.priceMinor), job.currency, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
