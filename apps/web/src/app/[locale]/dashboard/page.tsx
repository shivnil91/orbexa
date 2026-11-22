import { notFound } from "next/navigation";
import { FIXTURE_DASHBOARD, formatMinor, formatRate } from "@/lib/dashboard";
import { isSupportedLocale } from "@/lib/locale";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const row = FIXTURE_DASHBOARD[0];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-zinc-500">Milestone 4 · fixture</p>
        <h1 className="text-3xl font-semibold tracking-tight">Agent version dashboard</h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          These figures are computed from fixture rows shaped like run_metrics, llm_invocations,
          and drafts. They are not measurements from a live cell.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Grounded-claim rate</h2>
          <p className="mt-2 text-2xl">{formatRate(row.groundedClaimRate)}</p>
        </article>
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Latency</h2>
          <p className="mt-2 text-2xl">{row.latencyMs} ms</p>
        </article>
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Cost per job</h2>
          <p className="mt-2 text-2xl">{formatMinor(row.costPerJobMinor, row.currency)}</p>
        </article>
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Revision rate</h2>
          <p className="mt-2 text-2xl">{formatRate(row.revisionRate)}</p>
        </article>
      </section>
      <p className="text-sm leading-6 text-zinc-500">
        Agent version {row.agentVersionId}. Invocation cost {formatMinor(row.invocationCostMinor, row.currency)} across {row.jobCount} job.
        The database view is app.agent_version_metrics.
      </p>
    </main>
  );
}
