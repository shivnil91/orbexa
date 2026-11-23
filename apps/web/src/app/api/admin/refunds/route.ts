import { randomUUID } from "node:crypto";
import { updateDb } from "@/lib/demo-store";
import { approveReviewedRefund } from "@/lib/jobs";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  if (!user?.admin) {
    return redirectTo(request, `/${locale}/admin`, { error: "forbidden" });
  }
  const id = String(form.get("job") ?? "");
  try {
    const job = await approveReviewedRefund(id);
    await updateDb((db) => {
      db.audit = db.audit ?? [];
      db.audit.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        actorId: user.id,
        action: "refund_approve",
        targetId: job.id,
        detail: "guarantee",
      });
    });
  } catch {
    return redirectTo(request, `/${locale}/admin`, { error: "missing" });
  }
  return redirectTo(request, `/${locale}/admin`, { saved: "refund" });
}
