import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { isSupportedLocale } from "@/lib/locale";
import { readShare } from "@/lib/studio-store";
import { EXAMPLE_PANEL_BADGE } from "@/lib/studio-types";

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale, token } = await params;
  await connection();
  await searchParams;
  if (!isSupportedLocale(locale)) notFound();
  const share = await readShare(token);
  if (!share) notFound();
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Questions for {share.name}</h1>
        <p className="mt-3 text-sm leading-6">Your accountant asked for these answers. The lender panel stays with them.</p>
        {share.exampleData ? <p className="mt-3 text-sm font-semibold">{EXAMPLE_PANEL_BADGE}</p> : null}
      </header>
      <form action="/api/studio/run" className="grid gap-4" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="intent" type="hidden" value="share" />
        <input name="token" type="hidden" value={token} />
        {share.questions.map((question) => (
          <label key={question.id} className="grid gap-2 text-sm font-medium" htmlFor={question.id}>
            {question.prompt}
            <span className="font-normal">Why it matters: {question.why}</span>
            {question.kind === "choice" ? (
              <select className={inputClass} defaultValue={share.answers[question.id] ?? ""} id={question.id} name={`answer_${question.id}`}>
                <option value="">Choose</option>
                {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input className={inputClass} defaultValue={share.answers[question.id] ?? ""} id={question.id} name={`answer_${question.id}`} />
            )}
          </label>
        ))}
        <SubmitButton label="Save these answers" pendingLabel="Saving" />
      </form>
    </main>
  );
}
