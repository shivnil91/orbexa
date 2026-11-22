import { SandboxPanel } from "@/components/sandbox-panel";
import { SubmitButton } from "@/components/submit-button";
import { inputClass } from "@/components/styles";
import { t } from "@/lib/i18n";
import { CATEGORIES, categoryLabel, type CatalogItem } from "@/lib/marketplace";

function dollars(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function AgentForm({ locale, item }: { locale: string; item?: CatalogItem }) {
  const output = item?.exampleOutputs[0];
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
      <label className="grid gap-2 text-sm font-medium" htmlFor="knowledgeText">
        {t(locale, "sell.knowledge")}
        <textarea className={`${inputClass} min-h-24 py-2`} defaultValue={item?.knowledge[0]?.text ?? ""} id="knowledgeText" name="knowledgeText" maxLength={60000} />
      </label>
      <p className="text-sm text-muted">{t(locale, "sell.knowledgeHint")}</p>
      <label className="grid gap-2 text-sm font-medium" htmlFor="knowledgeFile">
        {t(locale, "sell.knowledgeFile")}
        <input className="min-h-11 text-sm" id="knowledgeFile" name="knowledgeFile" type="file" accept=".txt,.md,.json,text/plain" />
      </label>
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
