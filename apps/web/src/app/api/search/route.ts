import { saveSearch } from "@/lib/marketplace";
import { redirectTo } from "@/server/http";
import { currentUser } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const need = String(form.get("q") ?? "").trim();
  if (need.length < 3) {
    return redirectTo(request, `/${locale}/search`, { error: "need" });
  }
  const user = await currentUser();
  if (user) {
    await saveSearch(user.id, String(form.get("name") ?? ""), need);
  }
  return redirectTo(request, `/${locale}/search`, { q: need, saved: user ? "1" : undefined });
}
