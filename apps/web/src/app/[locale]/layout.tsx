import Link from "next/link";
import { t } from "@/lib/i18n";
import { isSupportedLocale, type Locale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const active: Locale = isSupportedLocale(locale) ? locale : "en";
  const user = await currentUser();
  const links = [
    ["nav.browse", `/${active}/listings`],
    ["nav.search", `/${active}/search`],
    ["nav.sell", `/${active}/sell`],
    ...(user ? [["nav.orders", `/${active}/orders`] as const] : []),
  ];
  return (
    <>
      <a className="skip-link" href="#content">{t(active, "skip")}</a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
          <Link className="text-lg font-semibold tracking-tight" href={`/${active}`}>{t(active, "nav.home")}</Link>
          <nav aria-label={t(active, "nav.primary")} className="flex max-w-full flex-wrap items-center gap-1">
            {links.map(([key, href]) => (
              <Link key={key} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm underline-offset-4 hover:underline" href={href}>
                {t(active, key)}
              </Link>
            ))}
            {user?.admin ? (
              <Link className="inline-flex min-h-11 items-center rounded-full px-3 text-sm underline-offset-4 hover:underline" href={`/${active}/admin`}>{t(active, "nav.admin")}</Link>
            ) : null}
            {user ? (
              <Link className="inline-flex min-h-11 items-center rounded-full px-3 text-sm underline-offset-4 hover:underline" href={`/${active}/account`}>{user.name}</Link>
            ) : (
              <Link className="inline-flex min-h-11 items-center rounded-full px-3 text-sm underline-offset-4 hover:underline" href={`/${active}/sign-in`}>{t(active, "nav.signIn")}</Link>
            )}
            {user ? (
              <form action="/api/auth/sign-out" method="post">
                <input name="locale" type="hidden" value={active} />
                <button className="inline-flex min-h-11 items-center rounded-full px-3 text-sm" type="submit">{t(active, "nav.signOut")}</button>
              </form>
            ) : (
              <Link className="inline-flex min-h-11 items-center rounded-full bg-accent px-3 text-sm font-medium text-accent-foreground" href={`/${active}/register`}>{t(active, "nav.register")}</Link>
            )}
          </nav>
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm leading-6 text-muted sm:px-8">
          <p>{t(active, "footer.honest")}</p>
          <nav aria-label={t(active, "footer.terms")} className="flex flex-wrap gap-4">
            <Link className="underline" href={`/${active}/terms`}>{t(active, "footer.terms")}</Link>
            <Link className="underline" href={`/${active}/privacy`}>{t(active, "footer.privacy")}</Link>
            <Link className="underline" href={`/${active}/dashboard`}>{t(active, "nav.metrics")}</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
