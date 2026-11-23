import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { inputClass } from "@/components/styles";
import { CALCULATOR_SPECS } from "@/lib/studio-calc";
import { EXAMPLE_PANEL_BADGE, INDICATIVE_LABEL } from "@/lib/studio-types";
import type { Gate } from "@/lib/studio-run";
import type { Proposal, StudioConfig, StudioRecord } from "@/lib/studio-types";

export function StudioWorkspace({
  locale,
  slug,
  name,
  config,
  studio,
  gates,
  leadCount,
}: {
  locale: string;
  slug: string;
  name: string;
  config: StudioConfig;
  studio: StudioRecord;
  gates: Gate[];
  leadCount: number;
}) {
  return (
    <div className="grid gap-8">
      {config.exampleData ? <p className="rounded-full bg-warning-bg px-3 py-1 text-sm font-semibold text-warning">{EXAMPLE_PANEL_BADGE}</p> : null}
      <p className="text-sm leading-6">Nothing in this studio is fine-tuned, and it is not used for training unless you turn that on. The switch starts off.</p>
      <section className="grid gap-3" aria-labelledby="gates-title">
        <h2 id="gates-title" className="text-2xl font-semibold">Readiness</h2>
        <ul className="grid gap-2">
          {gates.map((gate) => (
            <li key={gate.id} className="rounded-2xl border border-line p-4">
              <p className="font-semibold">{gate.label}: {gate.pass ? "Pass" : "Not met"}</p>
              <p className="mt-1 text-sm leading-6">{gate.detail}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <form action="/api/studio" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="slug" type="hidden" value={slug} />
            <input name="intent" type="hidden" value="bench" />
            <SubmitButton label="Run the test bench" pendingLabel="Running" />
          </form>
          <form action="/api/studio" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="slug" type="hidden" value={slug} />
            <input name="intent" type="hidden" value="publish" />
            <SubmitButton label="Publish listing" pendingLabel="Publishing" variant="secondary" />
          </form>
          <form action="/api/studio" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="slug" type="hidden" value={slug} />
            <input name="intent" type="hidden" value="publish-proven" />
            <SubmitButton label="Publish as Proven" pendingLabel="Checking" variant="secondary" />
          </form>
        </div>
      </section>
      <section className="grid gap-3" aria-labelledby="specialty-title">
        <h2 id="specialty-title" className="text-2xl font-semibold">Specialty</h2>
        <p className="text-sm leading-6">{config.specialty.niche}</p>
        <p className="text-sm leading-6">For: {config.specialty.audience}</p>
        <ul className="grid gap-2 text-sm">
          {config.specialty.scope.map((rule) => (
            <li key={rule.id}>{rule.action === "refuse" ? "Refuse" : "Hand off"} when “{rule.match}” appears. {rule.reason}</li>
          ))}
        </ul>
        <form action="/api/studio" className="grid gap-3" method="post">
          <input name="locale" type="hidden" value={locale} />
          <input name="slug" type="hidden" value={slug} />
          <input name="intent" type="hidden" value="specialty" />
          <label className="grid gap-2 text-sm font-medium" htmlFor="niche">Niche
            <textarea className={`${inputClass} min-h-20 py-2`} id="niche" name="niche" defaultValue={config.specialty.niche} />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="audience">Who it is for
            <textarea className={`${inputClass} min-h-20 py-2`} id="audience" name="audience" defaultValue={config.specialty.audience} />
          </label>
          <SubmitButton label="Save specialty" pendingLabel="Saving" variant="secondary" />
        </form>
      </section>
      <section className="grid gap-3" aria-labelledby="intake-title">
        <h2 id="intake-title" className="text-2xl font-semibold">Intake designer</h2>
        <ul className="grid gap-3">
          {config.intake.map((question) => (
            <li key={question.id} className="rounded-2xl border border-line p-4">
              <p className="font-medium">{question.prompt}{question.required ? " (required)" : ""}</p>
              <p className="mt-1 text-sm leading-6">Why it matters: {question.why}</p>
              {question.showWhen ? <p className="text-sm">Shown when {question.showWhen.questionId} is {question.showWhen.equals}.</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3" aria-labelledby="panel-title">
        <h2 id="panel-title" className="text-2xl font-semibold">Rules and panel</h2>
        <p className="text-sm leading-6">Hard knock-outs run in code. The model cannot add one.</p>
        <div aria-label="Rules and panel matrix" className="max-w-full overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="pb-2 text-left">Products against lenders. Each cell lists hard rules and a soft preference.</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-line p-2 text-left">Product</th>
                {config.lenders.map((lender) => <th key={lender.id} scope="col" className="border-b border-line p-2 text-left">{lender.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {config.products.map((product) => (
                <tr key={product.id}>
                  <th scope="row" className="border-b border-line p-2 text-left">{product.name}</th>
                  {config.lenders.map((lender) => {
                    const cell = config.cells.find((item) => item.productId === product.id && item.lenderId === lender.id);
                    return (
                      <td key={lender.id} className="border-b border-line p-2 align-top">
                        {cell ? `${cell.hard.minTradingMonths ?? "—"} months, revenue ${cell.hard.minAnnualRevenue ?? "—"}, credit ${cell.hard.creditClearRequired ? "clear" : "any"}, ATO ${cell.hard.maxAtoDebt ?? "—"}. ${cell.soft}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-3" aria-labelledby="calc-title">
        <h2 id="calc-title" className="text-2xl font-semibold">Calculators</h2>
        <ul className="grid gap-3">
          {config.calculators.map((calc) => (
            <li key={calc.id} className="rounded-2xl border border-line p-4">
              <p className="font-medium">{CALCULATOR_SPECS[calc.id].title}{calc.enabled ? "" : " (off)"}</p>
              <p className="mt-1 text-sm leading-6">Formula: {CALCULATOR_SPECS[calc.id].formula}</p>
              <p className="text-sm leading-6">Assumptions: {CALCULATOR_SPECS[calc.id].assumptions}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3" aria-labelledby="play-title">
        <h2 id="play-title" className="text-2xl font-semibold">Playbooks</h2>
        <ul className="grid gap-3">
          {config.playbooks.map((playbook) => (
            <li key={playbook.id} className="rounded-2xl border border-line p-4 text-sm leading-6">
              If you see {playbook.see}, do {playbook.do} because {playbook.because}
              {playbook.documents.length > 0 ? ` Documents: ${playbook.documents.join(", ")}.` : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3" aria-labelledby="template-title">
        <h2 id="template-title" className="text-2xl font-semibold">Output templates</h2>
        <ul className="grid gap-3">
          {config.templates.map((template) => (
            <li key={template.id} className="rounded-2xl border border-line p-4">
              <p className="font-medium">{template.title}</p>
              <p className="mt-1 text-sm leading-6">{template.preface}</p>
              {template.kind === "funding_report" ? <p className="text-sm">{INDICATIVE_LABEL}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3" aria-labelledby="hand-title">
        <h2 id="hand-title" className="text-2xl font-semibold">Human handoff</h2>
        <p className="text-sm leading-6">The broker’s fee is the agent price plus a qualified lead when the agent stops.</p>
        <ul className="grid gap-2 text-sm">
          {config.handoff.map((trigger) => <li key={trigger.id}>{trigger.kind} at {trigger.threshold}. {trigger.note}</li>)}
        </ul>
        {leadCount > 0 ? <p className="text-sm">{leadCount} broker lead{leadCount === 1 ? "" : "s"} waiting.</p> : null}
      </section>
      <section className="grid gap-3" aria-labelledby="bench-title">
        <h2 id="bench-title" className="text-2xl font-semibold">Test bench</h2>
        <p className="text-sm leading-6">Use anonymised past cases. Strip names, emails, and account numbers before you add one.</p>
        <ul className="grid gap-2">
          {(studio.lastBench?.results ?? []).map((row) => (
            <li key={row.id} className="rounded-2xl border border-line p-4 text-sm leading-6">
              <p className="font-medium">{row.pass ? "Pass" : "Fail"} · {row.title}{row.hardRule ? " · hard rule" : ""}</p>
              <p>Expected: {row.expected}</p>
              {row.missing.length > 0 ? <p>Missing from the output: {row.missing.join("; ")}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3" aria-labelledby="elicit-title">
        <h2 id="elicit-title" className="text-2xl font-semibold">Pull three past cases</h2>
        <p className="text-sm leading-6">The interviewer turns what you noticed into proposed questions, rules, playbooks, and tests. Nothing becomes active until you approve it.</p>
        <form action="/api/studio" className="grid gap-4" method="post">
          <input name="locale" type="hidden" value={locale} />
          <input name="slug" type="hidden" value={slug} />
          <input name="intent" type="hidden" value="interview" />
          {[1, 2, 3].map((index) => (
            <fieldset key={index} className="grid gap-3 rounded-2xl border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Case {index}</legend>
              <label className="grid gap-2 text-sm font-medium" htmlFor={`notice_${index}`}>What did you notice first?
                <textarea className={`${inputClass} min-h-16 py-2`} id={`notice_${index}`} name={`notice_${index}`} />
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor={`junior_${index}`}>What would a junior miss?
                <textarea className={`${inputClass} min-h-16 py-2`} id={`junior_${index}`} name={`junior_${index}`} />
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor={`killed_${index}`}>What killed the deal?
                <textarea className={`${inputClass} min-h-16 py-2`} id={`killed_${index}`} name={`killed_${index}`} />
              </label>
            </fieldset>
          ))}
          <SubmitButton label="Propose structured items" pendingLabel="Proposing" variant="secondary" />
        </form>
        <ProposalList locale={locale} proposals={studio.proposals} slug={slug} />
      </section>
      <section className="grid gap-3" aria-labelledby="correct-title">
        <h2 id="correct-title" className="text-2xl font-semibold">Teach by correcting</h2>
        <form action="/api/studio" className="grid gap-3" method="post">
          <input name="locale" type="hidden" value={locale} />
          <input name="slug" type="hidden" value={slug} />
          <input name="intent" type="hidden" value="correct" />
          <label className="grid gap-2 text-sm font-medium" htmlFor="before">Output before your edit
            <textarea className={`${inputClass} min-h-16 py-2`} id="before" name="before" />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="after">Output after your edit
            <textarea className={`${inputClass} min-h-16 py-2`} id="after" name="after" />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="reason">Why you changed it
            <textarea className={`${inputClass} min-h-16 py-2`} id="reason" name="reason" />
          </label>
          <SubmitButton label="Propose a rule from this edit" pendingLabel="Proposing" variant="secondary" />
        </form>
      </section>
      <section className="grid gap-3" aria-labelledby="version-title">
        <h2 id="version-title" className="text-2xl font-semibold">Versions</h2>
        <p className="text-sm">Agent: {name}. Published package version: {studio.publishedVersion ?? "none"}.</p>
        <ul className="grid gap-2">
          {studio.changelog.slice(-8).map((entry) => (
            <li key={`${entry.version}-${entry.at}`} className="text-sm">Version {entry.version} · {entry.action} · {entry.note}</li>
          ))}
        </ul>
        {studio.versions.slice(0, -1).slice(-5).map((version) => (
          <form key={version.number} action="/api/studio" method="post">
            <input name="locale" type="hidden" value={locale} />
            <input name="slug" type="hidden" value={slug} />
            <input name="intent" type="hidden" value="rollback" />
            <input name="version" type="hidden" value={String(version.number)} />
            <SubmitButton label={`Roll back to version ${version.number}`} pendingLabel="Rolling back" variant="secondary" />
          </form>
        ))}
      </section>
      <form action="/api/studio" className="grid gap-3" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="slug" type="hidden" value={slug} />
        <input name="intent" type="hidden" value="consent" />
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6" htmlFor="trainingConsent">
          <input className="mt-1 size-5" id="trainingConsent" name="trainingConsent" type="checkbox" value="yes" defaultChecked={studio.trainingConsent === true} />
          Allow this material to be marked for training. Off unless you check it. This demo does not train a model either way.
        </label>
        <SubmitButton label="Save training choice" pendingLabel="Saving" variant="secondary" />
      </form>
      <p className="text-sm"><Link className="underline" href={`/${locale}/listings/${slug}`}>Open the buyer listing</Link></p>
    </div>
  );
}

function ProposalList({ locale, proposals, slug }: { locale: string; proposals: Proposal[]; slug: string }) {
  const pending = proposals.filter((item) => item.status === "proposed");
  if (pending.length === 0) return <p className="text-sm">No proposals waiting.</p>;
  return (
    <ul className="grid gap-3">
      {pending.map((proposal) => (
        <li key={proposal.id} className="rounded-2xl border border-line p-4 text-sm leading-6">
          <p className="font-medium">{proposal.kind} · {proposal.source} · proposed</p>
          <p>{proposal.kind === "playbook" ? proposal.playbook.do : proposal.kind === "rule" ? proposal.note : proposal.kind === "case" ? proposal.bench.title : proposal.question.prompt}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action="/api/studio" method="post">
              <input name="locale" type="hidden" value={locale} />
              <input name="slug" type="hidden" value={slug} />
              <input name="intent" type="hidden" value="approve" />
              <input name="proposal" type="hidden" value={proposal.id} />
              <SubmitButton label="Approve" pendingLabel="Approving" />
            </form>
            <form action="/api/studio" method="post">
              <input name="locale" type="hidden" value={locale} />
              <input name="slug" type="hidden" value={slug} />
              <input name="intent" type="hidden" value="reject" />
              <input name="proposal" type="hidden" value={proposal.id} />
              <SubmitButton label="Reject" pendingLabel="Rejecting" variant="secondary" />
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
