import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signOutToken } from "@/lib/accounts";
import { requestIsSecure } from "@/lib/request-guard";
import { appUrl, formLocale } from "@/server/http";
import { sessionToken } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = formLocale(form);
  await signOutToken(await sessionToken());
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: requestIsSecure(request),
    maxAge: 0,
  });
  const response = NextResponse.redirect(appUrl(request, `/${locale}`), 303);
  response.headers.set("cache-control", "no-store");
  return response;
}
