import { acceptPhoto, safeNext, updateAccount, updateProfile } from "@/lib/accounts";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  if (!user) {
    return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/account` });
  }
  const result = await updateAccount(user.id, {
    name: String(form.get("name") ?? ""),
    bio: String(form.get("bio") ?? ""),
    role: String(form.get("role") ?? ""),
  });
  const next = safeNext(String(form.get("next") ?? ""), locale);
  if (!result.ok) {
    return redirectTo(request, next, { error: result.error });
  }
  let photoDataUrl: string | undefined;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 40_000) return redirectTo(request, next, { error: "photo" });
    const bytes = Buffer.from(await photo.arrayBuffer());
    const type = photo.type === "image/png" || photo.type === "image/jpeg" || photo.type === "image/webp" ? photo.type : "";
    if (!type) return redirectTo(request, next, { error: "photo" });
    photoDataUrl = `data:${type};base64,${bytes.toString("base64")}`;
    const accepted = acceptPhoto(photoDataUrl);
    if (!accepted.ok) return redirectTo(request, next, { error: accepted.error });
  }
  const profile = await updateProfile(user.id, {
    experience: String(form.get("experience") ?? ""),
    links: [1, 2, 3].map((index) => ({
      label: String(form.get(`linkLabel${index}`) ?? ""),
      href: String(form.get(`linkUrl${index}`) ?? ""),
    })),
    credentialTitle: String(form.get("credentialTitle") ?? ""),
    credentialIssuer: String(form.get("credentialIssuer") ?? ""),
    trainingConsent: form.get("trainingConsent") === "yes",
    photoDataUrl,
  });
  if (!profile.ok) {
    return redirectTo(request, next, { error: profile.error });
  }
  return redirectTo(request, next, { saved: "1" });
}
