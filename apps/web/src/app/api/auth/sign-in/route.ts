import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signInAccount } from "@/lib/accounts";
import { appUrl, redirectTo } from "@/server/http";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const requested = String(form.get("next") ?? "");
  const result = await signInAccount(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!result.ok) {
    return redirectTo(request, `/${locale}/sign-in`, { error: result.error, next: requested || undefined });
  }
  const next = requested.startsWith(`/${locale}/`) && !requested.includes("://") ? requested : `/${locale}/account`;
  const jar = await cookies();
  jar.set({ name: SESSION_COOKIE, value: result.token, httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return NextResponse.redirect(appUrl(request, next), 303);
}
