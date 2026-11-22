import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { pageClass, primaryButton, secondaryButton } from "@/components/styles";
import { canSell } from "@/lib/accounts";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sell" };

export default async function SellPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  const error = messageFor(locale, query.error);
  const mine = user ? (await loadCatalog()).filter((item) => item.ownerId === user.id) : [];
  return (
    <main id="content" className={pageClass}>
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "sell.title")}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{t(locale, "sell.lede")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!user ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p>{t(locale, "sell.needAccount")}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link className={primaryButton} href={`/${locale}/register?role=seller&next=/${locale}/sell`}>{t(locale, "nav.register")}</Link>
            <Link className={secondaryButton} href={`/${locale}/sign-in?next=/${locale}/sell`}>{t(locale, "nav.signIn")}</Link>
          </div>
        </section>
      ) : null}
      {user && !canSell(user.role) ? (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p>{t(locale, "sell.needRole")}</p>
          <form action="/api/account" className="mt-4" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="name" type="hidden" value={user.name} />
            <input name="bio" type="hidden" value={user.bio} />
            <input name="role" type="hidden" value="both" />
            <input name="next" type="hidden" value={`/${locale}/sell`} />
            <SubmitButton label={t(locale, "sell.switch")} pendingLabel={t(locale, "pending")} />
          </form>
        </section>
      ) : null}
      {user && canSell(user.role) ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link className={primaryButton} href={`/${locale}/sell/new`}>{t(locale, "sell.build")}</Link>
            <Link className={secondaryButton} href={`/${locale}/sell/dashboard`}>{t(locale, "sell.dashboard")}</Link>
          </div>
          <section>
            <h2 className="text-2xl font-semibold">{t(locale, "sell.yours")}</h2>
            {mine.length === 0 ? <p className="mt-3 rounded-2xl border border-line bg-surface p-5">{t(locale, "sell.empty")}</p> : (
              <ul className="mt-4 grid gap-3">
                {mine.map((item) => (
                  <li key={item.slug} className="rounded-2xl border border-line p-4">
                    <p className="text-sm text-muted">{t(locale, "sell.status")}: {item.status}</p>
                    <h3 className="mt-1 text-lg font-semibold">{item.name}</h3>
                    <Link className="mt-2 inline-flex min-h-11 items-center underline" href={`/${locale}/sell/${item.slug}`}>{t(locale, "sell.edit")}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
