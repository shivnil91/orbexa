import { NextResponse } from "next/server";
import type { FeedbackKind } from "@orbexa/db/feedback.ts";
import { canMutateJob } from "@/lib/job-access";
import { readJob, recordJobFeedback } from "@/lib/jobs";
import { appUrl, formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

const KINDS = new Set([
  "buyer_approve",
  "buyer_edit",
  "buyer_reject",
  "edit_distance",
  "tender_win",
  "tender_loss",
  "judge_score",
  "expert_rating",
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  const existing = await readJob(id);
  if (!existing || !canMutateJob(existing.tenantId, user)) {
    return redirectTo(request, `/${locale}/sign-in`, { error: "forbidden" });
  }
  const kind = String(form.get("kind") ?? "");
  if (!KINDS.has(kind) || form.get("body") || form.get("founderAuthorise")) {
    return redirectTo(request, `/${locale}/jobs/${existing.id}/review`, { error: "forbidden" });
  }
  const distance = form.get("editDistance");
  const rating = form.get("rating");
  const reason = String(form.get("reason") ?? "");
  try {
    const job = await recordJobFeedback(existing.id, {
      kind: kind as FeedbackKind,
      editDistance: typeof distance === "string" && distance.length > 0 ? Number(distance) : null,
      rating: typeof rating === "string" && rating.length > 0 ? Number(rating) : null,
      reason,
    });
    if (kind === "buyer_reject" && job.guarantee?.refundRequested) {
      return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}/review?saved=refund`), 303);
    }
    if (kind === "buyer_reject" && job.guarantee?.revisionUsed) {
      return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}/review?saved=revision`), 303);
    }
    return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}/review`), 303);
  } catch (error) {
    const code = error instanceof Error && error.message === "reason" ? "reason" : "forbidden";
    return redirectTo(request, `/${locale}/jobs/${existing.id}/review`, { error: code });
  }
}
