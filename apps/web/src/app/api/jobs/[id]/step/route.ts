import { NextResponse } from "next/server";
import { revealNext } from "@/lib/jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  try {
    const job = await revealNext(id);
    if (wantsJson) {
      return NextResponse.json({ cursor: job.cursor, status: job.status });
    }
  } catch {
    return NextResponse.json({ error: "step" }, { status: 400 });
  }
  return NextResponse.redirect(new URL(`/${locale}/jobs/${id}`, request.url), 303);
}
