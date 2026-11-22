import { updateAccount } from "@/lib/accounts";
import { redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const user = await currentUser();
  if (!user) {
    return redirectTo(request, `/${locale}/sign-in`, { next: `/${locale}/account` });
  }
  const result = await updateAccount(user.id, {
    name: String(form.get("name") ?? ""),
    bio: String(form.get("bio") ?? ""),
    role: String(form.get("role") ?? ""),
  });
  const requested = String(form.get("next") ?? "");
  const next = requested.startsWith(`/${locale}/`) && !requested.includes("://") ? requested : `/${locale}/account`;
  if (!result.ok) {
    return redirectTo(request, next, { error: result.error });
  }
  return redirectTo(request, next, { saved: "1" });
}
