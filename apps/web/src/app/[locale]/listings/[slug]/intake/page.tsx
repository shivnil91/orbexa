import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, pageClass } from "@/components/styles";
import { packFor, type ServiceLevel } from "@/lib/catalog";
import { messageFor, t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import { findItem } from "@/lib/marketplace";
import { loadCatalog } from "@/server/catalog";

const LEVELS = new Set(["autonomous", "expert_verified", "expert_led"]);

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ tier?: string; need?: string; error?: string }>;
}) {
  const { locale, slug } = await params;
  await connection();
  const query = await searchParams;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const item = findItem(await loadCatalog(), slug);
  if (!item || item.status !== "published" || !query.tier || !LEVELS.has(query.tier)) {
    notFound();
  }
  const tier = query.tier as ServiceLevel;
  const pack = packFor(item.listing);
  const files = pack.deliverableTypes.filter((file) => file.role === "intake");
  const error = messageFor(locale, query.error);
  return (
    <main id="content" className={`${pageClass} max-w-3xl`}>
      <header>
        <p className="text-sm text-muted">{t(locale, `level.${tier}`)} · {item.name}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t(locale, "intake.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t(locale, "intake.lede")}</p>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="grid gap-5 rounded-2xl border border-line bg-surface p-5" action="/api/jobs" method="post">
        <input name="locale" type="hidden" value={locale} />
        <input name="slug" type="hidden" value={item.slug} />
        <input name="tier" type="hidden" value={tier} />
        {Object.entries(pack.intakeSchema.properties ?? {}).map(([key, property]) => {
          const required = pack.intakeSchema.required?.includes(key) ?? false;
          return (
            <label key={key} className="grid gap-2 text-sm font-medium" htmlFor={key}>
              {t(locale, `fields.${key}`)}
              <input
                id={key}
                name={key}
                required={required}
                minLength={property.minLength}
                defaultValue={query.need ?? ""}
                className={inputClass}
                autoComplete="off"
              />
            </label>
          );
        })}
        {files.length > 0 ? (
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">{t(locale, "intake.files")}</legend>
            <p className="text-sm text-muted">{t(locale, "intake.fileHint")}</p>
            {files.map((file) => (
              <label key={file.code} className="grid gap-2 text-sm" htmlFor={file.code}>
                {file.code}
                <input id={file.code} name={file.code} type="file" accept={file.accept} className="min-h-11" />
              </label>
            ))}
          </fieldset>
        ) : null}
        <SubmitButton label={t(locale, "intake.submit")} pendingLabel={t(locale, "pending")} />
      </form>
    </main>
  );
}
