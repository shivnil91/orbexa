import { notFound } from "next/navigation";
import { listingBySlug, packFor, type ServiceLevel } from "@/lib/catalog";
import { t } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";

const LEVELS = new Set(["autonomous", "expert_verified", "expert_led"]);

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ tier?: string }>;
}) {
  const { locale, slug } = await params;
  const query = await searchParams;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const listing = listingBySlug(slug);
  if (!listing || !query.tier || !LEVELS.has(query.tier)) {
    notFound();
  }
  const tier = query.tier as ServiceLevel;
  const pack = packFor(listing);
  const schema = pack.intakeSchema;
  const files = pack.deliverableTypes.filter((item) => item.role === "intake");
  return (
    <main id="content" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-12 sm:px-8">
      <header>
        <p className="text-sm text-muted">{t(locale, `level.${tier}`)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t(locale, "intake.title")}</h1>
        <p className="mt-3 leading-7 text-muted">{t(locale, "intake.lede")}</p>
      </header>
      <form className="grid gap-5 rounded-2xl border border-line bg-surface p-5" action="/api/jobs" method="post">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={listing.slug} />
        <input type="hidden" name="tier" value={tier} />
        {Object.entries(schema.properties ?? {}).map(([key, property]) => {
          const required = schema.required?.includes(key) ?? false;
          const label = t(locale, `fields.${key}`);
          return (
            <label key={key} className="grid gap-2 text-sm font-medium" htmlFor={key}>
              {label}
              <input
                id={key}
                name={key}
                required={required}
                minLength={property.minLength}
                className="min-h-11 rounded-xl border border-line bg-background px-3 font-normal"
                autoComplete="off"
              />
            </label>
          );
        })}
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
        <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-accent-foreground" type="submit">
          {t(locale, "intake.submit")}
        </button>
      </form>
    </main>
  );
}
