import { NextResponse } from "next/server";
import { revealNext } from "@/lib/jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  await revealNext(id);
  return NextResponse.redirect(new URL(`/${locale}/jobs/${id}`, request.url), 303);
}
