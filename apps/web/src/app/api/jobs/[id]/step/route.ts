import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { readJob, revealNext } from "@/lib/jobs";
import { appUrl, formLocale, redirectTo, wantsJson } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const json = wantsJson(request);
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  const existing = await readJob(id);
  if (!existing || !canMutateJob(existing.tenantId, user)) {
    if (json) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return redirectTo(request, `/${locale}/sign-in`, { error: "forbidden" });
  }
  try {
    const job = await revealNext(existing.id);
    if (json) {
      return NextResponse.json({ cursor: job.cursor, status: job.status });
    }
    return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}`), 303);
  } catch {
    if (json) {
      return NextResponse.json({ error: "step" }, { status: 400 });
    }
    return redirectTo(request, `/${locale}/jobs/${existing.id}`, { error: "generic" });
  }
}
