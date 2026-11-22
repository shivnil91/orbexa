import { NextResponse } from "next/server";
import type { ServiceLevel } from "@/lib/catalog";
import { createJob } from "@/lib/jobs";
import { getCatalog, isListingSlug } from "@/lib/marketplace";
import { appUrl, formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

const LEVELS = new Set(["autonomous", "expert_verified", "expert_led"]);

export async function POST(request: Request) {
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
    return NextResponse.redirect(appUrl(request, `/${locale}/checkout?job=${job.id}`), 303);
  } catch {
    return redirectTo(request, `/${locale}/listings/${slug}/intake`, {
      tier,
      error: "intake",
      need: typeof intake.need === "string" ? intake.need : typeof intake.opportunity_name === "string" ? intake.opportunity_name : undefined,
    });
  }
}
