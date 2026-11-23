import { NextResponse } from "next/server";
import { logEvent } from "@/lib/log";
import type { ServiceLevel } from "@/lib/catalog";
import { createJob, payJob } from "@/lib/jobs";
import { getCatalog, isListingSlug } from "@/lib/marketplace";
import { stripeTestTransport } from "@/lib/payments";
import { appUrl, formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

const LEVELS = new Set(["autonomous", "expert_verified", "expert_led", "expert_review"]);

export async function POST(request: Request) {
  const started = Date.now();
  const form = await request.formData();
  const locale = formLocale(form);
  const slug = String(form.get("slug") ?? "");
  const tier = String(form.get("tier") ?? "");
  const intake: Record<string, unknown> = {};
  for (const key of ["opportunity_name", "need"]) {
    const value = form.get(key);
    if (typeof value === "string" && value.length > 0) {
      intake[key] = value;
    }
  }
  if (!isListingSlug(slug) || !LEVELS.has(tier)) {
    return redirectTo(request, `/${locale}/listings`, { error: "intake" });
  }
  const user = await currentUser();
  const item = (await getCatalog()).find((entry) => entry.slug === slug);
  if (item && !item.example && item.status === "published" && !user) {
    return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/listings/${slug}/intake` });
  }
  try {
    const job = await createJob({ locale, slug, tier: tier as ServiceLevel, intake, tenantId: user?.id });
    if (String(form.get("pay") ?? "") === "1") {
      try {
        const origin = appUrl(request, "/").origin;
        const paid = await payJob(job.id, stripeTestTransport, {
          successUrl: `${origin}/${locale}/jobs/${job.id}`,
          cancelUrl: `${origin}/${locale}/checkout?job=${job.id}`,
        });
        if (paid.stripeCheckoutUrl?.startsWith("https://checkout.stripe.com/") && paid.status === "checkout") {
          return NextResponse.redirect(paid.stripeCheckoutUrl, 303);
        }
        if (paid.status === "checkout") {
          return redirectTo(request, `/${locale}/checkout`, { job: job.id, notice: "stripe" });
        }
        return NextResponse.redirect(appUrl(request, `/${locale}/jobs/${job.id}`), 303);
      } catch (error) {
        const live = error instanceof Error && /live Stripe/.test(error.message);
        return redirectTo(request, `/${locale}/checkout`, { job: job.id, error: live ? "live" : "payment" });
      }
    }
    logEvent({ event: "request", route: "hire", durationMs: Date.now() - started, status: 303 });
    return NextResponse.redirect(appUrl(request, `/${locale}/checkout?job=${job.id}`), 303);
  } catch {
    return redirectTo(request, `/${locale}/listings/${slug}/intake`, {
      tier,
      error: "intake",
      need: typeof intake.need === "string" ? intake.need : typeof intake.opportunity_name === "string" ? intake.opportunity_name : undefined,
    });
  }
}
