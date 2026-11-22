import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SubmitButton } from "@/components/submit-button";
import { pageClass } from "@/components/styles";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { jobStatusKey, orderSummary } from "@/lib/job-access";
import { listJobs } from "@/lib/jobs";
import { isSupportedLocale } from "@/lib/locale";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Moderation" };

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user?.admin) {
    return (
      <main id="content" className={pageClass}>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "admin.title")}</h1>
        <p className="max-w-2xl leading-7">{t(locale, "admin.forbidden")}</p>
      </main>
    );
  }
  const items = await loadCatalog();
  const orders = (await listJobs()).slice(0, 40).map(orderSummary);
  return (
    <main id="content" className={pageClass}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "admin.title")}</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">{t(locale, "admin.lede")}</p>
      </header>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "admin.listings")}</h2>
        <ul className="mt-4 grid gap-3">
          {items.map((item) => (
            <li key={item.slug} className="rounded-2xl border border-line p-4">
              <p className="font-medium">{item.name}{item.example ? ` · ${t(locale, "card.example")}` : ""}</p>
              <p className="text-sm text-muted">{item.status} · {item.sellerName}</p>
              <form action="/api/admin/listings" className="mt-3 flex flex-wrap gap-2" method="post">
                <input name="locale" type="hidden" value={locale} />
                <input name="slug" type="hidden" value={item.slug} />
                <SubmitButton label={t(locale, "admin.suspend")} name="action" pendingLabel={t(locale, "pending")} value="suspend" variant="secondary" />
                <SubmitButton label={t(locale, "admin.reject")} name="action" pendingLabel={t(locale, "pending")} value="reject" variant="secondary" />
                <SubmitButton label={t(locale, "admin.restore")} name="action" pendingLabel={t(locale, "pending")} value="restore" variant="secondary" />
              </form>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "admin.orders")}</h2>
        {orders.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "orders.empty")}</p> : (
          <ul className="mt-3 grid gap-2 text-sm">
            {orders.map((job) => (
              <li key={job.id}>{job.title} · {t(locale, jobStatusKey(job.status, job.refunded))} · {formatMoney(BigInt(job.priceMinor), job.currency, locale)}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
