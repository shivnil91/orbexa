import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromToken, type PublicUser } from "@/lib/accounts";

export async function currentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}
