import { cookies } from "next/headers";
import { after } from "next/server";
import { canSell, registerAccount, sessionCookie, updateAccount } from "@/lib/accounts";
import { isListingSlug } from "@/lib/marketplace";
import { requestIsSecure } from "@/lib/request-guard";
import { queueStudioProof, createStudio, decideProposal, proposeCorrection, proposeInterview, publishStudio, rollbackStudio, runBench, saveSpecialty, setTrainingConsent } from "@/lib/studio-store";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const intent = String(form.get("intent") ?? "");
  const slug = String(form.get("slug") ?? "");
  let user = await currentUser();
  if (!user && intent === "create") {
    const registered = await registerAccount({
      name: String(form.get("accountName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      role: "seller",
      operatorCode: "",
    });
    if (!registered.ok) return redirectTo(request, `/${locale}/studio`, { error: registered.error });
    const jar = await cookies();
    jar.set(sessionCookie(registered.token, requestIsSecure(request)));
    user = registered.user;
  }
  if (!user) return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/studio` });
  if (!canSell(user.role)) {
    const upgraded = await updateAccount(user.id, { name: user.name, bio: user.bio, role: "both" });
    if (!upgraded.ok) return redirectTo(request, `/${locale}/studio`, { error: upgraded.error });
  }
  if (intent === "create") {
    const created = await createStudio(user.id, String(form.get("name") ?? ""), form.get("fromExample") === "yes");
    if (!created.ok) return redirectTo(request, `/${locale}/studio`, { error: created.error });
    return redirectTo(request, `/${locale}/studio/${created.slug}`);
  }
  if (!isListingSlug(slug)) return redirectTo(request, `/${locale}/studio`, { error: "missing" });
  const back = `/${locale}/studio/${slug}`;
  if (intent === "specialty") {
    const saved = await saveSpecialty(user.id, slug, {
      niche: String(form.get("niche") ?? ""),
      audience: String(form.get("audience") ?? ""),
      scope: [],
    });
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "bench") {
    const ran = await runBench(user.id, slug);
    if (!ran.ok) return redirectTo(request, back, { error: ran.error });
    return redirectTo(request, back);
  }
  if (intent === "publish" || intent === "publish-proven") {
    const saved = await publishStudio(user.id, slug, intent === "publish-proven" ? "proven" : "listing");
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    if (saved.proofQueued) after(() => queueStudioProof(saved.slug));
    return redirectTo(request, intent === "publish" ? `/${locale}/listings/${saved.slug}` : back);
  }
  if (intent === "rollback") {
    const saved = await rollbackStudio(user.id, slug, Number(form.get("version") ?? "0"));
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "consent") {
    const saved = await setTrainingConsent(user.id, slug, form.get("trainingConsent") === "yes");
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "interview") {
    const turns = [1, 2, 3].map((index) => ({
      notice: String(form.get(`notice_${index}`) ?? ""),
      junior: String(form.get(`junior_${index}`) ?? ""),
      killed: String(form.get(`killed_${index}`) ?? ""),
    }));
    const saved = await proposeInterview(user.id, slug, turns);
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "correct") {
    const saved = await proposeCorrection(user.id, slug, {
      before: String(form.get("before") ?? ""),
      after: String(form.get("after") ?? ""),
      reason: String(form.get("reason") ?? ""),
    });
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  if (intent === "approve" || intent === "reject") {
    const months = String(form.get("months") ?? "").trim();
    const saved = await decideProposal(user.id, slug, String(form.get("proposal") ?? ""), intent === "approve" ? "approved" : "rejected", months ? Number(months) : null);
    if (!saved.ok) return redirectTo(request, back, { error: saved.error });
    return redirectTo(request, back);
  }
  return redirectTo(request, back, { error: "generic" });
}
