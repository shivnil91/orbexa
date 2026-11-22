import { NextResponse } from "next/server";
import { isSupportedLocale } from "@/lib/locale";
import { browserOrigin, sameOriginUrl } from "@/lib/request-guard";

export function formLocale(form: FormData): string {
  const locale = String(form.get("locale") ?? "en");
  return isSupportedLocale(locale) ? locale : "en";
}

export function appUrl(request: Request, path: string): URL {
  const origin = browserOrigin(request) ?? new URL(request.url).origin;
  return sameOriginUrl(origin, path);
}

export function redirectTo(request: Request, path: string, params?: Record<string, string | undefined>): NextResponse {
  const url = appUrl(request, path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url, 303);
}

export function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}
