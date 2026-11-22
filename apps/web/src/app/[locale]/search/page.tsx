import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSupportedLocale } from "@/lib/locale";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; need?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  const active = isSupportedLocale(locale) ? locale : "en";
  const need = (query.need ?? query.q ?? "").trim();
  redirect(need ? `/${active}/get?need=${encodeURIComponent(need)}` : `/${active}/get`);
}
