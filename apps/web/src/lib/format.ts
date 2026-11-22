const SAMPLE_INSTANT = Date.UTC(2026, 10, 22, 12, 0, 0);

export function formatMoney(amountMinor: bigint, currency: string, locale: string): string {
  const exponent = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  const digits = exponent ?? 2;
  const scale = 10 ** digits;
  const amount = Number(amountMinor) / scale;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

export function formatInstant(timeZone: string, locale: string, instant = SAMPLE_INSTANT): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}
