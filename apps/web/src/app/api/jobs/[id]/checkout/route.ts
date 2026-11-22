import { NextResponse } from "next/server";
import { canMutateJob } from "@/lib/job-access";
import { payJob, readJob } from "@/lib/jobs";
import { stripeTestTransport } from "@/lib/payments";
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
  const origin = appUrl(request, "/").origin;
  try {
    const job = await payJob(id, stripeTestTransport, {
      successUrl: `${origin}/${locale}/jobs/${existing.id}`,
      cancelUrl: `${origin}/${locale}/checkout?job=${existing.id}`,
    });
    if (job.stripeCheckoutUrl?.startsWith("https://checkout.stripe.com/") && job.status === "checkout") {
      return NextResponse.redirect(job.stripeCheckoutUrl, 303);
    }
    if (job.status === "checkout") {
      return redirectTo(request, `/${locale}/checkout`, { job: existing.id, notice: "stripe" });
    }
    return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${existing.id}`), 303);
  } catch (error) {
    const live = error instanceof Error && /live Stripe/.test(error.message);
    return redirectTo(request, `/${locale}/checkout`, { job: existing.id, error: live ? "live" : "payment" });
  }
}
