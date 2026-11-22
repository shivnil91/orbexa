import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CatalogItem } from "@/lib/marketplace";
import { initials, JobMark, laneForCategory } from "./job-mark";

export function AgentCard({ locale, item }: { locale: string; item: CatalogItem }) {
  const price = formatMoney(BigInt(item.priceMinor), item.currency, locale);
  const rating = item.ratingCount === 0
    ? t(locale, "card.noRating")
    : t(locale, item.ratingExample ? "card.exampleRating" : "card.rating", {
        score: (item.ratingAverage ?? 0).toFixed(1),
        count: String(item.ratingCount),
      });
  const lane = laneForCategory(item.category);
  return (
    <article className="flex h-full min-w-0 flex-col rounded-3xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {lane ? <JobMark lane={lane} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-2xl font-semibold">{price}</p>
            {item.example ? <span className="rounded-full bg-warning-bg px-2 py-1 text-xs font-semibold text-warning">{t(locale, "card.example")}</span> : null}
          </div>
          <p className="text-sm font-medium text-muted">{t(locale, "home.turnaround")}</p>
        </div>
      </div>
      <h3 className="mt-4 font-display text-xl font-semibold leading-6">
        <Link className="underline decoration-transparent underline-offset-4 hover:decoration-current" href={`/${locale}/get?need=${encodeURIComponent(item.pitch)}`}>{item.name}</Link>
      </h3>
      <p className="mt-2 text-sm leading-6">{item.pitch}</p>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground" aria-hidden="true">{initials(item.sellerName)}</span>
        <p className="text-sm">
          <span className="sr-only">{item.sellerName}. </span>
          {rating}
        </p>
      </div>
    </article>
  );
}
