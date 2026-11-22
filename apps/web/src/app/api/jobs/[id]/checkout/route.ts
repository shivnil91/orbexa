import { NextResponse } from "next/server";
import { payJob } from "@/lib/jobs";
import { stripeTestTransport } from "@/lib/payments";
import { appUrl, redirectTo } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const origin = appUrl(request, "/").origin;
  try {
    const job = await payJob(id, stripeTestTransport, {
      successUrl: `${origin}/${locale}/jobs/${id}`,
      cancelUrl: `${origin}/${locale}/checkout?job=${id}`,
    });
    if (job.stripeCheckoutUrl && job.status === "checkout") {
      return NextResponse.redirect(job.stripeCheckoutUrl, 303);
    }
    if (job.status === "checkout") {
      return redirectTo(request, `/${locale}/checkout`, { job: id, notice: "stripe" });
    }
    return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${id}`), 303);
  } catch (error) {
    const live = error instanceof Error && /live Stripe/.test(error.message);
    return redirectTo(request, `/${locale}/checkout`, { job: id, error: live ? "live" : "payment" });
  }
}
