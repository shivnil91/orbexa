import { NextResponse } from "next/server";
import { setJobConsent } from "@/lib/jobs";
import { appUrl } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  if (form.get("founderAuthorise")) {
    return NextResponse.json({ error: "founder authorisation is not granted to the application" }, { status: 403 });
  }
  await setJobConsent(id, form.get("granted") === "yes");
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${id}/review`), 303);
}
