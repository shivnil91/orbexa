import { t } from "@/lib/i18n";
import type { DemoRun } from "@/lib/catalog";

export function EvidenceMatrix({ locale, transcript, showClaims }: { locale: string; transcript: DemoRun; showClaims: boolean }) {
  return (
    <div className="grid gap-6">
      <section className="min-w-0 max-w-full overflow-x-auto focus-visible:outline" tabIndex={0} aria-label={t(locale, "run.matrix")}>
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="mb-3 text-left text-lg font-semibold text-foreground">{t(locale, "run.matrix")}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-medium">{t(locale, "run.requirement")}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{t(locale, "run.support")}</th>
              <th scope="col" className="py-2 font-medium">{t(locale, "run.source")}</th>
            </tr>
          </thead>
          <tbody>
            {transcript.matrix.map((row) => (
              <tr key={row.body} className="border-b border-line align-top">
                <td className="py-3 pr-3">{row.body}</td>
                <td className="py-3 pr-3">
                  <span className={row.missing_evidence ? "rounded-full bg-missing-bg px-2 py-1 text-missing" : "rounded-full bg-supported-bg px-2 py-1 text-supported"}>
                    {row.missing_evidence ? t(locale, "run.missing") : t(locale, `run.${row.response_status === "not_addressed" ? "notAddressed" : row.response_status}`)}
                  </span>
                </td>
                <td className="py-3">{row.source || t(locale, "run.noCitation")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {showClaims ? (
        <section>
          <h2 className="text-lg font-semibold">{t(locale, "run.claims")}</h2>
          <ul className="mt-3 grid gap-3">
            {transcript.claims.map((claim) => (
              <li key={claim.body} className="rounded-2xl border border-line p-4">
                <p>{claim.body}</p>
                <p className="mt-2 text-sm">
                  <span className={claim.support_status === "missing_evidence" ? "text-missing" : "text-supported"}>
                    {t(locale, claim.support_status === "missing_evidence" ? "run.missing" : claim.support_status === "supported" ? "run.supported" : "run.unsupported")}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {claim.quote ? `${t(locale, "run.quote")}: ${claim.quote}` : t(locale, "run.noCitation")}
                  {claim.source ? ` · ${claim.source}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
