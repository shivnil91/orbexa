import { SandboxPanel } from "@/components/sandbox-panel";
import { SubmitButton } from "@/components/submit-button";
import { inputClass } from "@/components/styles";
import { t } from "@/lib/i18n";
import { CATEGORIES, categoryLabel, type CatalogItem } from "@/lib/marketplace";
import { INTERVIEW } from "@/lib/trust";

function dollars(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function AgentForm({ locale, item }: { locale: string; item?: CatalogItem }) {
  const output = item?.exampleOutputs[0];
  const textFor = (kind: string) => item?.assets.filter((asset) => asset.kind === kind).map((asset) => asset.text).join("\n\n") ?? "";
  const answerFor = (id: string) => item?.interview.find((entry) => entry.questionId === id)?.answer ?? "";
  return (
    <form className="grid gap-4" action="/api/agents" method="post" encType="multipart/form-data">
      <input name="locale" type="hidden" value={locale} />
      {item ? <input name="slug" type="hidden" value={item.slug} /> : null}
      <label className="grid gap-2 text-sm font-medium" htmlFor="name">
        {t(locale, "sell.name")}
        <input className={inputClass} defaultValue={item?.name ?? ""} id="name" name="name" required minLength={2} maxLength={80} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="pitch">
        {t(locale, "sell.pitch")}
        <input className={inputClass} defaultValue={item?.pitch ?? ""} id="pitch" name="pitch" maxLength={180} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="description">
        {t(locale, "sell.description")}
        <textarea className={`${inputClass} min-h-28 py-2`} defaultValue={item?.description ?? ""} id="description" name="description" maxLength={4000} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="category">
        {t(locale, "sell.category")}
        <select className={inputClass} defaultValue={item?.category ?? "engineering"} id="category" name="category">
          {CATEGORIES.map((category) => (
            <option key={category.code} value={category.code}>{categoryLabel(category.code)}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="instructions">
        {t(locale, "sell.instructions")}
        <textarea className={`${inputClass} min-h-36 py-2`} defaultValue={item?.instructions ?? ""} id="instructions" name="instructions" maxLength={8000} />
      </label>
      <section aria-labelledby="knowledge-capture" className="grid gap-4 rounded-2xl border border-line p-4">
        <h2 id="knowledge-capture" className="text-lg font-semibold">{t(locale, "knowledge.title")}</h2>
        <p className="text-sm leading-6 text-muted">{t(locale, "sell.knowledgeHint")}</p>
        <label className="grid gap-2 text-sm font-medium" htmlFor="knowledgeText">
          {t(locale, "sell.knowledge")}
          <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={textFor("rule") || item?.knowledge[0]?.text || ""} id="knowledgeText" name="knowledgeText" maxLength={60000} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="checklistText">
          {t(locale, "sell.checklist")}
          <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={textFor("checklist")} id="checklistText" name="checklistText" maxLength={60000} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="templateText">
          {t(locale, "sell.template")}
          <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={textFor("template")} id="templateText" name="templateText" maxLength={60000} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="exampleAssetText">
          {t(locale, "sell.pastExample")}
          <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={textFor("example")} id="exampleAssetText" name="exampleAssetText" maxLength={60000} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="assetKind">
          {t(locale, "sell.assetKind")}
          <select className={inputClass} defaultValue="rule" id="assetKind" name="assetKind">
            <option value="rule">{t(locale, "sell.ruleKind")}</option>
            <option value="checklist">{t(locale, "sell.checklist")}</option>
            <option value="template">{t(locale, "sell.template")}</option>
            <option value="example">{t(locale, "sell.pastExample")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="knowledgeFile">
          {t(locale, "sell.knowledgeFile")}
          <input className="min-h-11 text-sm" id="knowledgeFile" name="knowledgeFile" type="file" accept=".txt,.md,.json,text/plain" />
        </label>
        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold">{t(locale, "sell.interviewTitle")}</legend>
          <p className="text-sm leading-6 text-muted">{t(locale, "sell.interviewHint")}</p>
          {INTERVIEW.map((question) => (
            <label key={question.id} className="grid gap-2 text-sm font-medium" htmlFor={`interview_${question.id}`}>
              {question.prompt}
              <textarea className={`${inputClass} min-h-20 py-2`} defaultValue={answerFor(question.id)} id={`interview_${question.id}`} name={`interview_${question.id}`} maxLength={1000} />
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6" htmlFor="trainingConsent">
          <input className="mt-1 size-5" id="trainingConsent" name="trainingConsent" type="checkbox" value="yes" defaultChecked={item?.trainingConsent === true} />
          <span>{t(locale, "sell.training")}</span>
        </label>
      </section>
      <label className="grid gap-2 text-sm font-medium" htmlFor="exampleTitle">
        {t(locale, "sell.outputTitle")}
        <input className={inputClass} defaultValue={output?.title ?? ""} id="exampleTitle" name="exampleTitle" maxLength={80} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="exampleBody">
        {t(locale, "sell.outputBody")}
        <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={output?.body ?? ""} id="exampleBody" name="exampleBody" maxLength={2000} />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="price">
        {t(locale, "sell.price")}
        <input className={inputClass} defaultValue={item && item.priceMinor > 0 ? dollars(item.priceMinor) : ""} id="price" inputMode="decimal" name="price" />
      </label>
      <p className="text-sm text-muted">{t(locale, "sell.priceHint")}</p>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6" htmlFor="expertReview">
        <input className="mt-1 size-5" id="expertReview" name="expertReview" type="checkbox" value="yes" defaultChecked={item?.expertReview.enabled === true} />
        <span>{t(locale, "sell.expertReview")}</span>
      </label>
      <p className="text-sm text-muted">{t(locale, "sell.expertReviewHint")}</p>
      <label className="grid gap-2 text-sm font-medium" htmlFor="slaHours">
        {t(locale, "sell.sla")}
        <select className={inputClass} defaultValue={String(item?.expertReview.slaHours ?? 48)} id="slaHours" name="slaHours">
          <option value="24">24</option>
          <option value="48">48</option>
          <option value="72">72</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="reviewPrice">
        {t(locale, "sell.reviewPrice")}
        <input className={inputClass} id="reviewPrice" inputMode="decimal" name="reviewPrice" />
      </label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="sample">
        {t(locale, "sell.sample")}
        <input className={inputClass} id="sample" name="sample" />
      </label>
      <SandboxPanel errorLabel={t(locale, "sell.sandboxError")} testLabel={t(locale, "sell.test")} testingLabel={t(locale, "sell.testing")} title={t(locale, "sell.sandboxTitle")} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton label={t(locale, "sell.save")} name="intent" pendingLabel={t(locale, "pending")} value="draft" variant="secondary" />
        <SubmitButton label={t(locale, "sell.publish")} name="intent" pendingLabel={t(locale, "pending")} value="publish" />
        {item?.status === "published" ? <SubmitButton label={t(locale, "sell.unpublish")} name="intent" pendingLabel={t(locale, "pending")} value="unpublish" variant="secondary" /> : null}
      </div>
    </form>
  );
}
