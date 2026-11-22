import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { readJob, recordExpertSignal } from "@/lib/jobs";
import { appUrl, formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  const existing = await readJob(id);
  if (!existing || !canMutateJob(existing.tenantId, user)) {
    return redirectTo(request, `/${locale}/sign-in`, { error: "forbidden" });
  }
  try {
    await recordExpertSignal(existing.id);
  } catch {
    return redirectTo(request, `/${locale}/jobs/${existing.id}/review`, { error: "forbidden" });
  }
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}/review`), 303);
}
