import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { deliverPaidDraft, readJob } from "@/lib/jobs";
import { currentUser } from "@/server/session";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await currentUser();
  const existing = await readJob(id);
  if (!existing || !canMutateJob(existing.tenantId, user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const job = await deliverPaidDraft(existing.id);
    return NextResponse.json({
      status: job.status,
      refunded: job.refunded === true,
      error: job.modelError ?? null,
      paragraphs: job.paragraphs,
    });
  } catch {
    return NextResponse.json({ error: "provider" }, { status: 502 });
  }
}
