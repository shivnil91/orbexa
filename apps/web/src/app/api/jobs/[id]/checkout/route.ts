import { NextResponse } from "next/server";
import { payJob } from "@/lib/jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  await payJob(id);
  return NextResponse.redirect(new URL(`/${locale}/jobs/${id}`, request.url), 303);
}
