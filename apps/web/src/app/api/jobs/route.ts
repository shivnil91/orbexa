import { NextResponse } from "next/server";
import type { ServiceLevel } from "@/lib/catalog";
import { createJob } from "@/lib/jobs";

const LEVELS = new Set(["autonomous", "expert_verified", "expert_led"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const slug = String(form.get("slug") ?? "");
  const tier = String(form.get("tier") ?? "");
  if (!LEVELS.has(tier)) {
    return NextResponse.json({ error: "service level" }, { status: 400 });
  }
  const intake: Record<string, unknown> = {};
  const opportunity = form.get("opportunity_name");
  if (typeof opportunity === "string") {
    intake.opportunity_name = opportunity;
  }
  try {
    const job = await createJob({ locale, slug, tier: tier as ServiceLevel, intake });
    return NextResponse.redirect(new URL(`/${locale}/checkout?job=${job.id}`, request.url), 303);
  } catch {
    return NextResponse.json({ error: "intake" }, { status: 400 });
  }
}
