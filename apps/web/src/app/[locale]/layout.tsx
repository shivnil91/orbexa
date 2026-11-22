import Link from "next/link";
import { t } from "@/lib/i18n";
import { isSupportedLocale, type Locale } from "@/lib/locale";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const active: Locale = isSupportedLocale(locale) ? locale : "en";
  return (
    <>
      <a className="skip-link" href="#content">
        {t(active, "skip")}
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link className="text-lg font-semibold tracking-tight" href={`/${active}`}>
            {t(active, "nav.home")}
          </Link>
          <nav aria-label={t(active, "nav.listings")} className="flex gap-2">
            <Link className="inline-flex min-h-11 items-center rounded-full px-3 underline-offset-4 hover:underline" href={`/${active}/listings`}>
              {t(active, "nav.listings")}
            </Link>
            <Link className="inline-flex min-h-11 items-center rounded-full px-3 underline-offset-4 hover:underline" href={`/${active}/dashboard`}>
              {t(active, "nav.dashboard")}
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-6 text-sm leading-6 text-muted sm:px-8">{t(active, "footer.honest")}</p>
      </footer>
    </>
  );
}
