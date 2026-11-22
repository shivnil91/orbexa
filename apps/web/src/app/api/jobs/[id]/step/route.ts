import { NextResponse } from "next/server";
import { revealNext } from "@/lib/jobs";
import { appUrl, redirectTo, wantsJson } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const json = wantsJson(request);
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  try {
    const job = await revealNext(id);
    if (json) {
      return NextResponse.json({ cursor: job.cursor, status: job.status });
    }
  } catch {
    if (json) {
      return NextResponse.json({ error: "step" }, { status: 400 });
    }
    return redirectTo(request, `/${locale}/jobs/${id}`, { error: "generic" });
  }
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${id}`), 303);
}
