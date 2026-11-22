import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { categoryLabel, type CatalogItem } from "@/lib/marketplace";

export function AgentCard({ locale, item }: { locale: string; item: CatalogItem }) {
  const rating = item.ratingCount === 0
    ? t(locale, "card.noRating")
    : t(locale, item.ratingExample ? "card.exampleRating" : "card.rating", {
        score: (item.ratingAverage ?? 0).toFixed(1),
        count: String(item.ratingCount),
      });
  const runs = t(locale, item.runsExample ? "card.exampleRuns" : "card.runs", { count: String(item.runs) });
  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{categoryLabel(item.category)}</p>
        {item.example ? <span className="rounded-full border border-line px-2 py-0.5 text-xs">{t(locale, "card.example")}</span> : null}
      </div>
      <h3 className="mt-2 text-lg font-semibold leading-6">
        <Link className="underline-offset-4 hover:underline" href={`/${locale}/listings/${item.slug}`}>{item.name}</Link>
      </h3>
      <p className="mt-1 text-sm text-muted">{item.sellerName}</p>
      <p className="mt-3 text-sm leading-6">{item.pitch}</p>
      <p className="mt-3 text-sm">{rating}</p>
      <p className="text-sm text-muted">{runs}</p>
      <p className="mt-auto pt-4 font-medium">{t(locale, "card.from", { price: formatMoney(BigInt(item.priceMinor), item.currency, locale) })}</p>
    </article>
  );
}
