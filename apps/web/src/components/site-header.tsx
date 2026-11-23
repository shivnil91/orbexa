import Link from "next/link";

export function SiteHeader({
  homeHref,
  homeLabel,
  menuLabel,
  links,
  signInHref,
  signInLabel,
  accountHref,
  accountLabel,
  signOutLabel,
  locale,
}: {
  homeHref: string;
  homeLabel: string;
  menuLabel: string;
  links: { href: string; label: string }[];
  signInHref?: string;
  signInLabel?: string;
  accountHref?: string;
  accountLabel?: string;
  signOutLabel?: string;
  locale: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-8">
        <Link className="font-display text-xl font-semibold tracking-tight" href={homeHref}>{homeLabel}</Link>
        <details className="ml-auto sm:hidden">
          <summary aria-label={menuLabel} className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-line [&::-webkit-details-marker]:hidden">
            <span className="sr-only">{menuLabel}</span>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </summary>
          <nav aria-label="Primary" className="absolute inset-x-0 top-14 z-40 flex flex-col gap-1 border-b border-line bg-surface p-3">
            {links.map((link) => (
              <Link key={link.href} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium" href={link.href}>
                {link.label}
              </Link>
            ))}
            {signOutLabel ? (
              <form action="/api/auth/sign-out" method="post">
                <input name="locale" type="hidden" value={locale} />
                <button className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium" type="submit">{signOutLabel}</button>
              </form>
            ) : null}
          </nav>
        </details>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link key={link.href} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium" href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          {accountHref && accountLabel ? <Link className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium" href={accountHref}>{accountLabel}</Link> : null}
          {signOutLabel ? (
            <form action="/api/auth/sign-out" method="post">
              <input name="locale" type="hidden" value={locale} />
              <button className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium" type="submit">{signOutLabel}</button>
            </form>
          ) : null}
          {signInHref && signInLabel ? <Link className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground" href={signInHref}>{signInLabel}</Link> : null}
        </div>
        <div className="sm:hidden">
          {accountHref && accountLabel ? <Link className="inline-flex min-h-11 items-center px-2 text-sm font-medium" href={accountHref}>{accountLabel}</Link> : null}
          {signInHref && signInLabel ? <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold" href={signInHref}>{signInLabel}</Link> : null}
        </div>
      </div>
    </header>
  );
}
