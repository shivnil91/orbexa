import { NextResponse, type NextRequest } from "next/server";
import { isSupportedLocale } from "@/lib/locale";

export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  const locale = isSupportedLocale(segment) ? segment : "en";
  const headers = new Headers(request.headers);
  headers.set("x-orbexa-locale", locale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next|api|samples|favicon.ico|health).*)"],
};
