import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { echoNext } from "@/lib/accounts";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const next = echoNext(query.next, locale);
  if (await currentUser()) redirect(next ?? `/${locale}/account`);
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-xl`}>
      <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "auth.signInTitle")}</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action="/api/auth/sign-in" className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="next" type="hidden" value={next ?? ""} />
        <label className="grid gap-2 text-sm font-medium" htmlFor="email">
          {t(locale, "auth.email")}
          <input className={inputClass} id="email" name="email" type="email" required autoComplete="email" />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="password">
          {t(locale, "auth.password")}
          <input className={inputClass} id="password" name="password" type="password" required autoComplete="current-password" />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="operatorCode">
          {t(locale, "auth.operatorCode")}
          <input className={inputClass} id="operatorCode" name="operatorCode" type="password" autoComplete="off" />
        </label>
        <p className="text-sm text-muted">{t(locale, "auth.operatorHint")}</p>
        <SubmitButton label={t(locale, "auth.signInSubmit")} pendingLabel={t(locale, "pending")} />
      </form>
      <p className="text-sm">{t(locale, "auth.needAccount")} <Link className="underline" href={`/${locale}/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>{t(locale, "nav.register")}</Link></p>
    </main>
  );
}
