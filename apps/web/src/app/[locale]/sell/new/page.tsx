import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AgentForm } from "@/components/agent-form";
import { Notice } from "@/components/notice";
import { pageClass } from "@/components/styles";
import { canSell } from "@/lib/accounts";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { currentUser } from "@/server/session";

export const metadata: Metadata = { title: "Build an agent" };

export default async function NewAgentPage({
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
  if (!user) redirect(`/${locale}/sign-in?next=/${locale}/sell/new`);
  if (!canSell(user.role)) redirect(`/${locale}/sell?error=role`);
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "sell.build")}</h1>
        <p className="mt-3 leading-7 text-muted">{t(locale, "sell.lede")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <AgentForm locale={locale} />
    </main>
  );
}
