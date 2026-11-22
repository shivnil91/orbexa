import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { readJob, setJobConsent } from "@/lib/jobs";
import { appUrl, formLocale } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = formLocale(form);
  if (form.get("founderAuthorise")) {
    return NextResponse.json({ error: "founder authorisation is not granted to the application" }, { status: 403 });
  }
  const user = await currentUser();
  const existing = await readJob(id);
  if (!existing || !canMutateJob(existing.tenantId, user)) {
    return NextResponse.redirect(appUrl(request, `/${locale}/sign-in`), 303);
  }
  await setJobConsent(existing.id, form.get("granted") === "yes");
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}/review`), 303);
}
