import { canMutateJob } from "@/lib/job-access";
import { readJob } from "@/lib/jobs";
import { addReview } from "@/lib/marketplace";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const jobId = String(form.get("job") ?? "");
  const user = await currentUser();
  const job = await readJob(jobId);
  if (!user || !job || !canMutateJob(job.tenantId, user) || job.tenantId !== user.id) {
    return redirectTo(request, `/${locale}/sign-in`, { error: "forbidden" });
  }
  if (job.status !== "accepted" && job.status !== "waiting_for_buyer") {
    return redirectTo(request, `/${locale}/jobs/${job.id}/review`, { error: "forbidden" });
  }
  const result = await addReview({
    agentSlug: job.listingSlug,
    jobId: job.id,
    buyerId: user.id,
    buyerName: user.name,
    rating: Number(form.get("rating")),
    body: String(form.get("body") ?? ""),
  });
  if (!result.ok) {
    return redirectTo(request, `/${locale}/jobs/${job.id}/review`, { error: result.error });
  }
  return redirectTo(request, `/${locale}/jobs/${job.id}/review`, { saved: "1" });
}
