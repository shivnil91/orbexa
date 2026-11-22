import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { ConnectState, Role, UserRecord } from "./demo-store.ts";
import { emptyConnect, readDb, updateDb } from "./demo-store.ts";

export const SESSION_COOKIE = "orbexa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

const DUMMY = hashPassword("not-a-real-password");

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  bio: string;
  role: Role;
  admin: boolean;
  connect: ConnectState;
};

export type AuthResult = { ok: true; token: string; user: PublicUser } | { ok: false; error: string };

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = scryptSync(password, salt, 32);
  const stored = Buffer.from(expected, "hex");
  if (actual.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(actual, stored);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionSetCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function isAdminEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = (env.ORBEXA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return list.includes(email.trim().toLowerCase());
}

export function canSell(role: Role): boolean {
  return role === "seller" || role === "both";
}

export function toPublic(user: UserRecord, env: NodeJS.ProcessEnv = process.env): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    bio: user.bio,
    role: user.role,
    admin: isAdminEmail(user.email, env),
    connect: user.connect ?? emptyConnect(),
  };
}

export function safeNext(value: string | null | undefined, locale: string): string {
  if (!value || !value.startsWith(`/${locale}/`) || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return `/${locale}/account`;
  }
  return value;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

function validRole(role: string): role is Role {
  return role === "buyer" || role === "seller" || role === "both";
}

export async function registerAccount(input: { name: string; email: string; password: string; role: string }): Promise<AuthResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: "name" };
  }
  if (!validEmail(email)) {
    return { ok: false, error: "email" };
  }
  if (password.length < 8 || password.length > 200) {
    return { ok: false, error: "password" };
  }
  const role = input.role;
  if (!validRole(role)) {
    return { ok: false, error: "role" };
  }
  const passwordRecord = hashPassword(password);
  const now = new Date().toISOString();
  const token = randomBytes(32).toString("hex");
  try {
    const user = await updateDb((db) => {
      if (db.users.some((item) => item.email === email)) {
        return null;
      }
      const created: UserRecord = {
        id: randomUUID(),
        email,
        name,
        bio: "",
        role,
        passwordHash: passwordRecord.hash,
        passwordSalt: passwordRecord.salt,
        createdAt: now,
        connect: emptyConnect(),
      };
      db.users.push(created);
      db.sessions.push({
        tokenHash: hashToken(token),
        userId: created.id,
        expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
      });
      return created;
    });
    if (!user) {
      return { ok: false, error: "taken" };
    }
    return { ok: true, token, user: toPublic(user) };
  } catch {
    return { ok: false, error: "store" };
  }
}

export async function signInAccount(emailRaw: string, password: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  const db = await readDb();
  const user = db.users.find((item) => item.email === email);
  const match = user ? verifyPassword(password, user.passwordSalt, user.passwordHash) : verifyPassword(password, DUMMY.salt, DUMMY.hash);
  if (!user || !match) {
    return { ok: false, error: "credentials" };
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await updateDb((current) => {
    current.sessions = current.sessions.filter((session) => session.expiresAt > new Date().toISOString() && session.userId !== user.id);
    current.sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt });
  });
  return { ok: true, token, user: toPublic(user) };
}

export async function userFromToken(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token || token.length < 32) {
    return null;
  }
  const db = await readDb();
  const session = db.sessions.find((item) => item.tokenHash === hashToken(token));
  if (!session || session.expiresAt <= new Date().toISOString()) {
    return null;
  }
  const user = db.users.find((item) => item.id === session.userId);
  return user ? toPublic(user) : null;
}

export async function signOutToken(token: string | undefined | null): Promise<void> {
  if (!token) {
    return;
  }
  const tokenHash = hashToken(token);
  await updateDb((db) => {
    db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
  });
}

export async function updateAccount(userId: string, input: { name: string; bio: string; role: string }): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const name = input.name.trim();
  const bio = input.bio.trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: "name" };
  }
  if (bio.length > 500) {
    return { ok: false, error: "bio" };
  }
  const role = input.role;
  if (!validRole(role)) {
    return { ok: false, error: "role" };
  }
  const user = await updateDb((db) => {
    const current = db.users.find((item) => item.id === userId);
    if (!current) {
      return null;
    }
    current.name = name;
    current.bio = bio;
    current.role = role;
    return current;
  });
  if (!user) {
    return { ok: false, error: "missing" };
  }
  return { ok: true, user: toPublic(user) };
}

export async function updateConnect(userId: string, connect: ConnectState): Promise<void> {
  await updateDb((db) => {
    const current = db.users.find((item) => item.id === userId);
    if (current) {
      current.connect = connect;
    }
  });
}
