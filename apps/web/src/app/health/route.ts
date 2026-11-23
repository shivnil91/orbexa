import { connection, NextResponse } from "next/server";
import { healthReport } from "@/lib/health";
import { logEvent } from "@/lib/log";

export async function GET() {
  await connection();
  const started = Date.now();
  const report = await healthReport(process.env, async () => {
    const { pingMarket } = await import("@/lib/repository");
    return pingMarket();
  });
  if (report.status >= 500) logEvent({ event: "http_5xx", route: "health", status: report.status });
  logEvent({ event: "request", route: "health", durationMs: Date.now() - started, status: report.status });
  return NextResponse.json(report.body, { status: report.status });
}
