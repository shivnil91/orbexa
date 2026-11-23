import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { canSell } from "@/lib/accounts";
import { messageFor } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { NDIS_EXAMPLE_SLUG } from "@/lib/studio-ndis";
import { readDb } from "@/lib/demo-store";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Expert Agent Studio" };

export default async function StudioPage({
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
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/studio`);
  if (!canSell(user.role)) redirect(`/${locale}/earn`);
  const db = await readDb();
  const mine = db.agents.filter((agent) => agent.ownerId === user.id && agent.studio);
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Expert Agent Studio</h1>
        <p className="mt-3 text-lg leading-8">Build a specialist agent: intake, hard rules, calculators, playbooks, and the point where you take the deal. A one-line listing stays on Earn. This is the workspace for a domain.</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm leading-6"><Link className="underline" href={`/${locale}/listings/${NDIS_EXAMPLE_SLUG}`}>Open the example NDIS funding desk</Link>. It is example data, not a real lender panel.</p>
      <form action="/api/studio" className="grid gap-4 rounded-2xl border border-line bg-surface p-5" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="intent" type="hidden" value="create" />
        <label className="grid gap-2 text-sm font-medium" htmlFor="name">Agent name
          <input className={inputClass} id="name" name="name" required minLength={2} maxLength={80} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Starting point</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm" htmlFor="from-example">
            <input defaultChecked id="from-example" name="fromExample" type="radio" value="yes" />
            Start from the NDIS example
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm" htmlFor="from-blank">
            <input id="from-blank" name="fromExample" type="radio" value="no" />
            Start blank
          </label>
        </fieldset>
        <SubmitButton label="Create the studio" pendingLabel="Creating" />
      </form>
      <section aria-labelledby="mine-title">
        <h2 id="mine-title" className="text-2xl font-semibold">Your studios</h2>
        {mine.length === 0 ? <p className="mt-2 text-sm">None yet.</p> : (
          <ul className="mt-3 grid gap-2">
            {mine.map((agent) => (
              <li key={agent.slug}><Link className="underline" href={`/${locale}/studio/${agent.slug}`}>{agent.name}</Link></li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
