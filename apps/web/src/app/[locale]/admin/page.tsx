import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SubmitButton } from "@/components/submit-button";
import { pageClass } from "@/components/styles";
import { readDb } from "@/lib/demo-store";
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
  const jobs = await listJobs();
  const orders = jobs.slice(0, 40).map(orderSummary);
  const refunds = jobs.filter((job) => job.guarantee?.refundRequested && job.refunded !== true);
  const db = await readDb();
  const credentials = db.users.flatMap((person) => (person.credentials ?? []).filter((item) => item.status === "self_declared").map((item) => ({ userId: person.id, name: person.name, ...item })));
  const audit = (db.audit ?? []).slice(-20).reverse();
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
        <h2 className="text-2xl font-semibold">{t(locale, "admin.credentials")}</h2>
        {credentials.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "admin.noCredentials")}</p> : (
          <ul className="mt-3 grid gap-3">
            {credentials.map((credential) => (
              <li key={credential.id} className="rounded-2xl border border-line p-4 text-sm">
                <p>{credential.name} · {credential.title} · {credential.issuer} · {t(locale, "listing.selfDeclared")}</p>
                <form action="/api/admin/credentials" className="mt-3" method="post">
                  <input name="locale" type="hidden" value={locale} />
                  <input name="userId" type="hidden" value={credential.userId} />
                  <input name="credentialId" type="hidden" value={credential.id} />
                  <SubmitButton label={t(locale, "admin.verify")} pendingLabel={t(locale, "pending")} />
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "admin.refunds")}</h2>
        {refunds.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "admin.noRefunds")}</p> : (
          <ul className="mt-3 grid gap-3">
            {refunds.map((job) => (
              <li key={job.id} className="rounded-2xl border border-line p-4 text-sm">
                <p className="font-medium">{job.title}</p>
                <p className="mt-1">{job.guarantee?.refundReason}</p>
                <form action="/api/admin/refunds" className="mt-3" method="post">
                  <input name="locale" type="hidden" value={locale} />
                  <input name="job" type="hidden" value={job.id} />
                  <SubmitButton label={t(locale, "admin.approveRefund")} pendingLabel={t(locale, "pending")} />
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-2xl font-semibold">{t(locale, "admin.audit")}</h2>
        {audit.length === 0 ? <p className="mt-3 text-sm text-muted">{t(locale, "orders.empty")}</p> : (
          <ul className="mt-3 grid gap-1 text-sm">
            {audit.map((event) => (
              <li key={event.id}>{event.at} · {event.action} · {event.targetId}</li>
            ))}
          </ul>
        )}
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
