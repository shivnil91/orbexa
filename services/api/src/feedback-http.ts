import { validateFeedback, type FeedbackInput } from "@orbexa/db/feedback.ts";

export type FeedbackDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function acceptFeedback(body: unknown): FeedbackDecision {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "feedback" };
  }
  const record = body as FeedbackInput & { founderAuthorise?: boolean };
  if (record.founderAuthorise) {
    return { ok: false, status: 403, error: "founder authorisation is not granted to the application" };
  }
  try {
    validateFeedback(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "feedback";
    return { ok: false, status: 400, error: message };
  }
  return { ok: true };
}
