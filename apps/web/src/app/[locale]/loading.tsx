import { t } from "@/lib/i18n";

export default function Loading() {
  return (
    <main id="content" className="mx-auto min-h-dvh w-full max-w-6xl px-4 py-12">
      <p className="text-lg text-muted" role="status">{t("en", "loading")}</p>
    </main>
  );
}
