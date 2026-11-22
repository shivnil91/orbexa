import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StickyBar } from "@/components/sticky-bar";
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
    { href: `/${active}/get`, label: t(active, "home.buyerDoor") },
    { href: `/${active}/earn`, label: t(active, "home.sellerDoor") },
    ...(user ? [{ href: `/${active}/orders`, label: t(active, "nav.orders") }] : []),
    ...(user?.admin ? [{ href: `/${active}/admin`, label: t(active, "nav.admin") }] : []),
  ];
  return (
    <>
      <a className="skip-link" href="#content">{t(active, "skip")}</a>
      <p className="flex h-9 items-center justify-center bg-accent px-4 text-center text-xs font-medium text-accent-foreground">{t(active, "banner.demo")}</p>
      <SiteHeader
        accountHref={user ? `/${active}/account` : undefined}
        accountLabel={user?.name}
        homeHref={`/${active}`}
        homeLabel={t(active, "nav.home")}
        links={links}
        locale={active}
        menuLabel={t(active, "nav.menu")}
        signInHref={user ? undefined : `/${active}/sign-in`}
        signInLabel={user ? undefined : t(active, "nav.signIn")}
        signOutLabel={user ? t(active, "nav.signOut") : undefined}
      />
      <div className="mobile-cta-space min-w-0 flex-1">{children}</div>
      <StickyBar buyerLabel={t(active, "home.buyerDoor")} locale={active} sellerLabel={t(active, "sticky.publish")} />
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
