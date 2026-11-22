import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signOutToken } from "@/lib/accounts";
import { appUrl } from "@/server/http";
import { sessionToken } from "@/server/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  await signOutToken(await sessionToken());
  const jar = await cookies();
  jar.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return NextResponse.redirect(appUrl(request, `/${locale}`), 303);
}
