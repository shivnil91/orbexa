import { safeNext, updateAccount } from "@/lib/accounts";
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
  return redirectTo(request, next, { saved: "1" });
}
