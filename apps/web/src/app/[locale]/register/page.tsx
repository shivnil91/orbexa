import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string; role?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  if (await currentUser()) redirect(`/${locale}/account`);
  const role = query.role === "seller" || query.role === "both" ? query.role : "buyer";
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "auth.registerTitle")}</h1>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action="/api/auth/register" className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="next" type="hidden" value={query.next ?? ""} />
        <label className="grid gap-2 text-sm font-medium" htmlFor="name">
          {t(locale, "auth.name")}
          <input className={inputClass} id="name" name="name" required autoComplete="name" />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="email">
          {t(locale, "auth.email")}
          <input className={inputClass} id="email" name="email" type="email" required autoComplete="email" />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="password">
          {t(locale, "auth.password")}
          <input className={inputClass} id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <p className="text-sm text-muted">{t(locale, "auth.passwordHint")}</p>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t(locale, "auth.role")}</legend>
          {(["buyer", "seller", "both"] as const).map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-3 text-sm">
              <input defaultChecked={role === option} name="role" type="radio" value={option} />
              {t(locale, option === "buyer" ? "auth.roleBuyer" : option === "seller" ? "auth.roleSeller" : "auth.roleBoth")}
            </label>
          ))}
        </fieldset>
        <SubmitButton label={t(locale, "auth.create")} pendingLabel={t(locale, "pending")} />
      </form>
      <p className="text-sm">{t(locale, "auth.haveAccount")} <Link className="underline" href={`/${locale}/sign-in${query.next ? `?next=${encodeURIComponent(query.next)}` : ""}`}>{t(locale, "nav.signIn")}</Link></p>
    </main>
  );
}
