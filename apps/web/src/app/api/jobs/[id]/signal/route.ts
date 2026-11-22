import { NextResponse } from "next/server";
import { recordExpertSignal } from "@/lib/jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  await recordExpertSignal(id);
  return NextResponse.redirect(new URL(`/${locale}/jobs/${id}/review`, request.url), 303);
}
