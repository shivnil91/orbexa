import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CatalogItem } from "@/lib/marketplace";

export function AgentCard({ locale, item }: { locale: string; item: CatalogItem }) {
  const price = formatMoney(BigInt(item.priceMinor), item.currency, locale);
  const rating = item.ratingCount === 0
    ? t(locale, "card.noRating")
    : t(locale, item.ratingExample ? "card.exampleRating" : "card.rating", {
        score: (item.ratingAverage ?? 0).toFixed(1),
        count: String(item.ratingCount),
      });
  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xl font-semibold">{price}</p>
        {item.example ? <span className="rounded-full border border-line px-2 py-1 text-xs font-medium">{t(locale, "card.example")}</span> : null}
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-6">
        <Link className="underline" href={`/${locale}/get?need=${encodeURIComponent(item.pitch)}`}>{item.name}</Link>
      </h3>
      <p className="mt-1 text-sm font-medium">{t(locale, "home.turnaround")}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{item.pitch}</p>
      <p className="mt-2 text-sm">{rating}</p>
    </article>
  );
}
