import { NextResponse } from "next/server";
import { recordExpertSignal } from "@/lib/jobs";
import { appUrl, redirectTo } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  try {
    await recordExpertSignal(id);
  } catch {
    return redirectTo(request, `/${locale}/jobs/${id}/review`, { error: "forbidden" });
  }
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${id}/review`), 303);
}
