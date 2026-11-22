import { t } from "@/lib/i18n";

export default function LocaleNotFound() {
  return (
    <main id="content" className="mx-auto flex max-w-xl flex-1 flex-col gap-3 px-5 py-16">
      <h1 className="text-2xl font-semibold">{t("en", "notFound.title")}</h1>
      <p className="text-muted">{t("en", "notFound.body")}</p>
    </main>
  );
}
