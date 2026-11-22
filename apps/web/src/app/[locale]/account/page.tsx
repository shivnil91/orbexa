import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass, secondaryButton } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { searchesFor } from "@/lib/marketplace";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/account`);
  const searches = await searchesFor(user.id);
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "auth.accountTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{user.email}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {query.saved ? <Notice tone="info">{t(locale, "auth.save")}</Notice> : null}
      <form action="/api/account" className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="post">
        <input name="locale" type="hidden" value={locale} />
        <label className="grid gap-2 text-sm font-medium" htmlFor="name">
          {t(locale, "auth.name")}
          <input className={inputClass} defaultValue={user.name} id="name" name="name" required />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="bio">
          {t(locale, "auth.bio")}
          <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={user.bio} id="bio" name="bio" maxLength={500} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t(locale, "auth.role")}</legend>
          {(["buyer", "seller", "both"] as const).map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-3 text-sm">
              <input defaultChecked={user.role === option} name="role" type="radio" value={option} />
              {t(locale, option === "buyer" ? "auth.roleBuyer" : option === "seller" ? "auth.roleSeller" : "auth.roleBoth")}
            </label>
          ))}
        </fieldset>
        <SubmitButton label={t(locale, "auth.save")} pendingLabel={t(locale, "pending")} />
      </form>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link className={secondaryButton} href={`/${locale}/orders`}>{t(locale, "auth.buying")}</Link>
        <Link className={secondaryButton} href={`/${locale}/sell`}>{t(locale, "auth.selling")}</Link>
        <Link className={secondaryButton} href={`/${locale}/dashboard`}>{t(locale, "nav.metrics")}</Link>
      </div>
      <section>
        <h2 className="text-xl font-semibold">{t(locale, "search.saved")}</h2>
        {searches.length === 0 ? <p className="mt-2 text-sm text-muted">{t(locale, "search.empty")}</p> : (
          <ul className="mt-3 grid gap-2">
            {searches.map((search) => (
              <li key={search.id}>
                <Link className="underline" href={`/${locale}/search?q=${encodeURIComponent(search.need)}`}>{search.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
