import { notFound } from "next/navigation";
import { formatInstant, formatMoney } from "@/lib/format";
import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-zinc-500">Tender writing</p>
        <h1 className="text-3xl font-semibold tracking-tight">Orbexa foundation</h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          This screen is the engineering scaffold. Buyers and experts do not register here yet.
          A specialist category is a vertical pack: intake form, deliverable types, rubric, and
          workflow. The local hospital-bed slice is the first pack, Rahul buying Moishin&apos;s agent.
          It runs in tests and at POST /v1/demo/hospital-beds on the API. It uses a fixture model
          and a fake payment adapter.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Three service levels</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            Autonomous, Expert Verified, and Expert Led. Price, timeline, revisions, cancellation,
            and payout release are fields on the listing, not hardcoded currencies.
          </p>
        </article>
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Four memory domains</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            Creator expertise, buyer-private context, execution scratch, and approved reusable
            intelligence. Retrieval is tenant-scoped in Postgres.
          </p>
        </article>
        <article className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">One cell until approved</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            The schema is global. Deploying a region, spending money, or taking a live payment
            waits for an explicit founder approval.
          </p>
        </article>
      </section>
      <p className="text-sm">
        <a className="underline" href={`/${locale}/dashboard`}>
          Agent version dashboard
        </a>
      </p>
      <section className="rounded-lg bg-zinc-50 p-4 text-sm leading-6 dark:bg-zinc-900">
        <h2 className="font-medium">Sample formatting, not a price</h2>
        <p className="mt-2">USD in en-US: {formatMoney(BigInt(1050), "USD", "en-US")}</p>
        <p>EUR in de-DE: {formatMoney(BigInt(1050), "EUR", "de-DE")}</p>
        <p>Same instant in Auckland: {formatInstant("Pacific/Auckland", "en-NZ")}</p>
        <p>Same instant in London: {formatInstant("Europe/London", "en-GB")}</p>
      </section>
    </main>
  );
}
