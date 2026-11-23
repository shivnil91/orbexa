import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSupportedLocale } from "@/lib/locale";

export default async function SellPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ skill?: string; error?: string }>;
}) {
  const { locale } = await params;
  await connection();
  const query = await searchParams;
  const active = isSupportedLocale(locale) ? locale : "en";
  const target = new URL(`/${active}/earn`, "http://orbexa.local");
  if (query.skill) target.searchParams.set("skill", query.skill);
  if (query.error) target.searchParams.set("error", query.error);
  redirect(`${target.pathname}${target.search}`);
}
