import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { StudioWorkspace } from "@/components/studio-workspace";
import { pageClass } from "@/components/styles";
import { messageFor } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { leadsFor, readOwnedStudio, studioGates } from "@/lib/studio-store";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Expert Agent Studio" };

export default async function StudioEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, slug } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/studio/${slug}`);
  const owned = await readOwnedStudio(user.id, slug);
  if (!owned) notFound();
  const error = messageFor(locale, query.error);
  const leads = await leadsFor(user.id, slug);
  return (
    <main id="content" className={pageClass}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{owned.agent.name}</h1>
        <p className="mt-2 text-sm">Expert Agent Studio · {owned.agent.status}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <StudioWorkspace
        config={owned.config}
        gates={studioGates(owned.agent)}
        leadCount={leads.length}
        locale={locale}
        name={owned.agent.name}
        slug={slug}
        studio={owned.studio}
      />
    </main>
  );
}
