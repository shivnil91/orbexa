import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { metricsLogPath } from "@/lib/jobs";
import { metricsFromLog } from "@/lib/metrics-log";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  let text = "";
  try {
    text = await readFile(metricsLogPath(), "utf8");
  } catch {
    text = "";
  }
  const rows = metricsFromLog(text);
  const bandit = process.env.ORBEXA_BANDIT === "1";
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-12 sm:px-8">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">{t(locale, "dashboard.title")}</h1>
        <p className="mt-3 text-lg leading-8 text-muted">{t(locale, "dashboard.lede")}</p>
        <p className="mt-2 text-sm text-muted">{bandit ? t(locale, "dashboard.banditOn") : t(locale, "dashboard.banditOff")}</p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-5">{t(locale, "dashboard.empty")}</p>
      ) : (
        rows.map((row) => (
          <section key={`${row.agentVersionId}:${row.currency}`} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-2xl border border-line p-4">
                <h2 className="font-medium">{t(locale, "dashboard.grounded")}</h2>
                <p className="mt-2 text-3xl">{Math.round(row.groundedClaimRate * 1000) / 10}%</p>
              </article>
              <article className="rounded-2xl border border-line p-4">
                <h2 className="font-medium">{t(locale, "dashboard.latency")}</h2>
                <p className="mt-2 text-3xl">{Math.round(row.latencyMs)} ms</p>
              </article>
              <article className="rounded-2xl border border-line p-4">
                <h2 className="font-medium">{t(locale, "dashboard.cost")}</h2>
                <p className="mt-2 text-3xl">{formatMoney(BigInt(Math.round(row.costPerJobMinor)), row.currency, locale)}</p>
              </article>
              <article className="rounded-2xl border border-line p-4">
                <h2 className="font-medium">{t(locale, "dashboard.revisions")}</h2>
                <p className="mt-2 text-3xl">{Math.round(row.revisionRate * 1000) / 10}%</p>
              </article>
            </div>
            <p className="text-sm leading-6 text-muted">
              {t(locale, "dashboard.version")} {row.agentVersionId}. {t(locale, "dashboard.invocation")} {formatMoney(BigInt(Math.round(row.invocationCostMinor)), row.currency, locale)}. {t(locale, "dashboard.tokens")} {row.inputTokens}+{row.outputTokens}. {t(locale, "dashboard.jobs", { count: String(row.jobCount) })} {t(locale, "dashboard.estimate")}
            </p>
          </section>
        ))
      )}
    </main>
  );
}
