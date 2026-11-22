import { NextResponse } from "next/server";

export function appUrl(request: Request, path: string): URL {
  const current = new URL(request.url);
  const headerHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = headerHost && /^[A-Za-z0-9.\-:]+$/.test(headerHost) ? headerHost : current.host;
  const proto = request.headers.get("x-forwarded-proto") ?? current.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}/`);
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
