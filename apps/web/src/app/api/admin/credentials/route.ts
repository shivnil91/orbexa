import { verifyCredential } from "@/lib/accounts";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  if (!user?.admin) {
    return redirectTo(request, `/${locale}/admin`, { error: "forbidden" });
  }
  const result = await verifyCredential(user, String(form.get("userId") ?? ""), String(form.get("credentialId") ?? ""));
  return redirectTo(request, `/${locale}/admin`, { error: result.ok ? undefined : result.error, saved: result.ok ? "verified" : undefined });
}
