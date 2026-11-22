import { NextResponse, type NextRequest } from "next/server";
import { decideDemoAuth, readDemoBasicAuth } from "@/lib/demo-auth";
import { isSupportedLocale } from "@/lib/locale";
import { browserOrigin, csrfAllows } from "@/lib/request-guard";

export function proxy(request: NextRequest) {
  const decision = decideDemoAuth({
    method: request.method,
    pathname: request.nextUrl.pathname,
    authorization: request.headers.get("authorization"),
    demoBasicAuth: readDemoBasicAuth(),
  });
  if (!decision.allow) {
    return new NextResponse("Authentication required", {
      status: decision.status,
      headers: {
        "WWW-Authenticate": decision.wwwAuthenticate,
        "Cache-Control": "no-store",
      },
    });
  }
  if (!csrfAllows({
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    browserOrigin: browserOrigin(request),
  })) {
    return new NextResponse("Cross-site request refused", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  const locale = isSupportedLocale(segment) ? segment : "en";
  const headers = new Headers(request.headers);
  headers.set("x-orbexa-locale", locale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
