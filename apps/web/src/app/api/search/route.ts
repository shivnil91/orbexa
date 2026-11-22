import { saveSearch } from "@/lib/marketplace";
import { formLocale, redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const need = String(form.get("q") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 500);
  if (need.length < 3) {
    return redirectTo(request, `/${locale}/search`, { error: "need" });
  }
  const user = await currentUser();
  if (user) {
    await saveSearch(user.id, String(form.get("name") ?? ""), need);
  }
  return redirectTo(request, `/${locale}/search`, { q: need, saved: user ? "1" : undefined });
}
