import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AgentForm } from "@/components/agent-form";
import { Notice } from "@/components/notice";
import { pageClass } from "@/components/styles";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { findItem } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Edit agent" };

export default async function EditAgentPage({
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
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/sell/${slug}`);
  const item = findItem(await loadCatalog(), slug, user.id, user.admin);
  if (!item || item.ownerId !== user.id || item.example) notFound();
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{item.name}</h1>
        <p className="mt-2 text-sm text-muted">{t(locale, "sell.status")}: {item.status}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <AgentForm item={item} locale={locale} />
    </main>
  );
}
