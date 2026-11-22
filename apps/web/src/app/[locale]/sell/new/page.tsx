import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSupportedLocale } from "@/lib/locale";

export default async function NewAgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  const active = isSupportedLocale(locale) ? locale : "en";
  redirect(`/${active}/earn`);
}
