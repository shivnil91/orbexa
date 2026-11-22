import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { echoNext, safeNext, sessionCookie, signInAccount } from "@/lib/accounts";
import { requestIsSecure } from "@/lib/request-guard";
import { appUrl, formLocale, redirectTo } from "@/server/http";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  const requested = String(form.get("next") ?? "");
  const result = await signInAccount(
    String(form.get("email") ?? ""),
    String(form.get("password") ?? ""),
    String(form.get("operatorCode") ?? ""),
  );
  if (!result.ok) {
    return redirectTo(request, `/${locale}/sign-in`, { error: result.error, next: echoNext(requested, locale) });
  }
  const jar = await cookies();
  jar.set(sessionCookie(result.token, requestIsSecure(request)));
  const response = NextResponse.redirect(appUrl(request, safeNext(requested, locale)), 303);
  response.headers.set("cache-control", "no-store");
  return response;
}
