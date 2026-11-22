import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { pageClass, primaryButton } from "@/components/styles";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  const orders = user ? (await listJobs()).filter((job) => job.tenantId === user.id) : [];
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "orders.title")}</h1>
      </header>
      {!user ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p>{t(locale, "orders.signIn")}</p>
          <Link className={`${primaryButton} mt-4`} href={`/${locale}/sign-in?next=/${locale}/orders`}>{t(locale, "nav.signIn")}</Link>
        </section>
      ) : null}
      {user && orders.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-5">{t(locale, "orders.empty")} {t(locale, "empty.orders")}</p> : null}
      {orders.length > 0 ? (
        <ul className="grid gap-3">
          {orders.map((job) => (
            <li key={job.id} className="rounded-2xl border border-line p-4">
              <h2 className="text-lg font-semibold">{job.title}</h2>
              <p className="mt-1 text-sm text-muted">{job.opportunityName}</p>
              <p className="mt-2 text-sm">{t(locale, `status.${job.status}`)} · {formatMoney(BigInt(job.priceMinor), job.currency, locale)}</p>
              <Link className="mt-3 inline-flex min-h-11 items-center underline" href={job.status === "checkout" ? `/${locale}/checkout?job=${job.id}` : `/${locale}/jobs/${job.id}`}>
                {t(locale, "orders.open")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
