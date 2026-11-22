import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/notice";
import { pageClass } from "@/components/styles";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "privacy.title")}</h1>
      <Notice>{t(locale, "legal.draft")}</Notice>
      <p className="leading-7">{t(locale, "privacy.p1")}</p>
      <p className="leading-7">{t(locale, "privacy.p2")}</p>
      <p className="leading-7">{t(locale, "privacy.p3")}</p>
    </main>
  );
}
