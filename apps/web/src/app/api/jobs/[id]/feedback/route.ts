import { NextResponse } from "next/server";
import { recordJobFeedback } from "@/lib/jobs";
import type { FeedbackKind } from "@orbexa/db/feedback.ts";
import { appUrl, redirectTo } from "@/server/http";

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
  const locale = String(form.get("locale") ?? "en");
  const kind = String(form.get("kind") ?? "");
  if (!KINDS.has(kind) || form.get("body") || form.get("founderAuthorise")) {
    return redirectTo(request, `/${locale}/jobs/${id}/review`, { error: "forbidden" });
  }
  const distance = form.get("editDistance");
  const rating = form.get("rating");
  try {
    await recordJobFeedback(id, {
      kind: kind as FeedbackKind,
      editDistance: typeof distance === "string" && distance.length > 0 ? Number(distance) : null,
      rating: typeof rating === "string" && rating.length > 0 ? Number(rating) : null,
    });
  } catch {
    return redirectTo(request, `/${locale}/jobs/${id}/review`, { error: "forbidden" });
  }
  return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${id}/review`), 303);
}
