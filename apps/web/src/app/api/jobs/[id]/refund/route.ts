import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { readJob, refundUnreleasedJob } from "@/lib/jobs";
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
  if (form.get("amount") || form.get("destinationAccountId")) {
    return redirectTo(request, `/${locale}/jobs/${existing.id}`, { error: "forbidden" });
  }
  const job = await refundUnreleasedJob(existing.id);
  if (!job) {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${job.id}`), 303);
}
