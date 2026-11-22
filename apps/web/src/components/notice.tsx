export function Notice({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "error" | "info" }) {
  const className = tone === "error"
    ? "rounded-xl bg-missing-bg p-3 text-sm leading-6 text-missing"
    : tone === "info"
      ? "rounded-xl border border-line bg-surface p-3 text-sm leading-6 text-muted"
      : "rounded-xl bg-warning-bg p-3 text-sm leading-6 text-warning";
  return <p role={tone === "error" ? "alert" : "status"} className={className}>{children}</p>;
}
