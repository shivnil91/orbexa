import { after } from "next/server";
import { isListingSlug } from "@/lib/marketplace";
import { queueProofRerun, scheduleProof } from "@/lib/proof";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const slug = String(form.get("slug") ?? "");
  const back = isListingSlug(slug) ? `/${locale}/sell/${slug}` : `/${locale}/sell`;
  const user = await currentUser();
  if (!user) return redirectTo(request, `/${locale}/sign-in`, { next: back });
  if (!isListingSlug(slug)) return redirectTo(request, back, { error: "missing" });
  const result = await queueProofRerun(user.id, slug);
  if (!result.ok) return redirectTo(request, back, { error: result.error });
  scheduleProof(slug);
  after(() => {
    scheduleProof(slug);
  });
  return redirectTo(request, `/${locale}/listings/${slug}`);
}
