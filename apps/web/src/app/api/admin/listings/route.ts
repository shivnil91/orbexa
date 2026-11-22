import { moderateListing } from "@/lib/marketplace";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const user = await currentUser();
  if (!user?.admin) {
    return redirectTo(request, `/${locale}/admin`, { error: "forbidden" });
  }
  const action = String(form.get("action") ?? "");
  const slug = String(form.get("slug") ?? "");
  if (action !== "suspend" && action !== "restore" && action !== "reject") {
    return redirectTo(request, `/${locale}/admin`, { error: "generic" });
  }
  const ok = await moderateListing(slug, action);
  return redirectTo(request, `/${locale}/admin`, { error: ok ? undefined : "missing" });
}
