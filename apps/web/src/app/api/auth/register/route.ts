import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { echoNext, registerAccount, safeNext, sessionCookie } from "@/lib/accounts";
import { requestIsSecure } from "@/lib/request-guard";
import { appUrl, formLocale, redirectTo } from "@/server/http";

function destination(locale: string, requested: string, role: string): string {
  const next = echoNext(requested, locale);
  if (next) {
    return next;
  }
  return safeNext(role === "buyer" ? `/${locale}/account` : `/${locale}/sell`, locale);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const requested = String(form.get("next") ?? "");
  const result = await registerAccount({
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    role: String(form.get("role") ?? ""),
    operatorCode: String(form.get("operatorCode") ?? ""),
  });
  if (!result.ok) {
    return redirectTo(request, `/${locale}/register`, {
      error: result.error,
      next: echoNext(requested, locale),
      role: String(form.get("role") ?? "") || undefined,
    });
  }
  const jar = await cookies();
  jar.set(sessionCookie(result.token, requestIsSecure(request)));
  const response = NextResponse.redirect(appUrl(request, destination(locale, requested, result.user.role)), 303);
  response.headers.set("cache-control", "no-store");
  return response;
}
