import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { registerAccount, SESSION_COOKIE } from "@/lib/accounts";
import { appUrl, redirectTo } from "@/server/http";

function destination(locale: string, requested: string, role: string): string {
  if (requested.startsWith(`/${locale}/`) && !requested.startsWith("//") && !requested.includes("://")) {
    return requested;
  }
  return role === "buyer" ? `/${locale}/account` : `/${locale}/sell`;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const requested = String(form.get("next") ?? "");
  const result = await registerAccount({
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    role: String(form.get("role") ?? ""),
  });
  if (!result.ok) {
    return redirectTo(request, `/${locale}/register`, { error: result.error, next: requested || undefined, role: String(form.get("role") ?? "") || undefined });
  }
  const jar = await cookies();
  jar.set({ name: SESSION_COOKIE, value: result.token, httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return NextResponse.redirect(appUrl(request, destination(locale, requested, result.user.role)), 303);
}
