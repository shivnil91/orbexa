import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { ConnectState, CredentialRecord, ProfileLink, Role, UserRecord } from "./demo-store.ts";
import { emptyConnect, readDb, updateDb } from "./demo-store.ts";
import { isSupportedLocale } from "./locale.ts";

export const SESSION_COOKIE = "orbexa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SIGN_IN_LIMIT = 8;
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; resetAt: number }>();

const DUMMY = hashPassword("not-a-real-password");

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  bio: string;
  role: Role;
  admin: boolean;
  connect: ConnectState;
  experience: string;
  links: ProfileLink[];
  credentials: CredentialRecord[];
  trainingConsent: boolean;
  photoDataUrl: string;
};

export type AuthResult = { ok: true; token: string; user: PublicUser } | { ok: false; error: string };

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 32, SCRYPT).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = scryptSync(password, salt, 32, SCRYPT);
  const validHex = /^[0-9a-f]{64}$/i.test(expected);
  const stored = validHex ? Buffer.from(expected, "hex") : Buffer.alloc(32);
  const matches = stored.length === actual.length && timingSafeEqual(actual, stored);
  return validHex && matches;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_SECONDS) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge,
  };
}

export function sessionSetCookie(token: string, secure = false): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${secureFlag}`;
}

export function sessionClearCookie(secure = false): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;
}

export function operatorCodeMatches(provided: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.ORBEXA_ADMIN_BOOTSTRAP ?? "";
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return expected.length >= 16 && provided.length > 0 && timingSafeEqual(left, right);
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
    admin: user.operator === true && isAdminEmail(user.email, env),
    connect: user.connect ?? emptyConnect(),
    experience: user.experience ?? "",
    links: user.links ?? [],
    credentials: user.credentials ?? [],
    trainingConsent: user.trainingConsent === true,
    photoDataUrl: user.photoDataUrl ?? "",
  };
}

export function safeNext(value: string | null | undefined, locale: string): string {
  const home = isSupportedLocale(locale) ? `/${locale}/account` : "/en/account";
  if (!value || !isSupportedLocale(locale)) {
    return home;
  }
  if (value.length > 300 || /[\u0000-\u001f\u007f\\]/.test(value)) {
    return home;
  }
  try {
    const url = new URL(value, "http://orbexa.local");
    if (url.origin !== "http://orbexa.local" || !url.pathname.startsWith(`/${locale}/`) || url.pathname.includes("//")) {
      return home;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return home;
  }
}

export function echoNext(value: string | null | undefined, locale: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const safe = safeNext(value, locale);
  return safe === value ? value : undefined;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

function validRole(role: string): role is Role {
  return role === "buyer" || role === "seller" || role === "both";
}

function signInLimited(email: string): boolean {
  const row = failures.get(email);
  if (!row || row.resetAt <= Date.now()) {
    return false;
  }
  return row.count >= SIGN_IN_LIMIT;
}

function markSignInFailure(email: string): void {
  const now = Date.now();
  const row = failures.get(email);
  if (!row || row.resetAt <= now) {
    failures.set(email, { count: 1, resetAt: now + SIGN_IN_WINDOW_MS });
    return;
  }
  row.count += 1;
}

export async function registerAccount(
  input: { name: string; email: string; password: string; role: string; operatorCode?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthResult> {
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
  const reserved = isAdminEmail(email, env);
  const operator = reserved && operatorCodeMatches(input.operatorCode ?? "", env);
  if (reserved && !operator) {
    return { ok: false, error: "operator" };
  }
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
        operator,
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
    return { ok: true, token, user: toPublic(user, env) };
  } catch {
    return { ok: false, error: "store" };
  }
}

export async function signInAccount(
  emailRaw: string,
  password: string,
  operatorCode = "",
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  if (password.length < 1 || password.length > 200) {
    return { ok: false, error: "credentials" };
  }
  const db = await readDb();
  const user = db.users.find((item) => item.email === email);
  const match = user ? verifyPassword(password, user.passwordSalt, user.passwordHash) : verifyPassword(password, DUMMY.salt, DUMMY.hash);
  if (!user || !match || signInLimited(email)) {
    if (!user || !match) {
      markSignInFailure(email);
    }
    return { ok: false, error: "credentials" };
  }
  failures.delete(email);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const grantOperator = operatorCodeMatches(operatorCode, env) && isAdminEmail(user.email, env);
  await updateDb((current) => {
    const row = current.users.find((item) => item.id === user.id);
    if (row && grantOperator) {
      row.operator = true;
      user.operator = true;
    }
    current.sessions = current.sessions.filter((session) => session.expiresAt > new Date().toISOString() && session.userId !== user.id);
    current.sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt });
  });
  return { ok: true, token, user: toPublic(user, env) };
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

function cleanLinks(raw: ProfileLink[]): { ok: true; links: ProfileLink[] } | { ok: false; error: string } {
  const links: ProfileLink[] = [];
  for (const item of raw.slice(0, 3)) {
    const label = item.label.trim().slice(0, 40);
    const href = item.href.trim();
    if (!label && !href) continue;
    if (!label || !href.startsWith("https://") || href.length > 200 || /[\s<>]/.test(href)) {
      return { ok: false, error: "link" };
    }
    links.push({ label, href });
  }
  return { ok: true, links };
}

export function acceptPhoto(dataUrl: string): { ok: true; photo: string } | { ok: false; error: string } {
  if (!dataUrl) return { ok: true, photo: "" };
  if (dataUrl.length > 60_000 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) {
    return { ok: false, error: "photo" };
  }
  return { ok: true, photo: dataUrl };
}

export async function updateProfile(
  userId: string,
  input: { experience: string; links: ProfileLink[]; credentialTitle: string; credentialIssuer: string; trainingConsent: boolean; photoDataUrl?: string },
): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  const experience = input.experience.trim();
  if (experience.length > 400) return { ok: false, error: "experience" };
  const links = cleanLinks(input.links);
  if (!links.ok) return links;
  const title = input.credentialTitle.trim().slice(0, 80);
  const issuer = input.credentialIssuer.trim().slice(0, 80);
  if ((title && !issuer) || (!title && issuer)) return { ok: false, error: "credential" };
  const photo = input.photoDataUrl === undefined ? undefined : acceptPhoto(input.photoDataUrl);
  if (photo && !photo.ok) return photo;
  const user = await updateDb((db) => {
    const current = db.users.find((item) => item.id === userId);
    if (!current) return null;
    current.experience = experience;
    current.links = links.links;
    current.trainingConsent = input.trainingConsent === true;
    if (photo) current.photoDataUrl = photo.photo;
    if (title && issuer) {
      const credentials = current.credentials ?? [];
      const exists = credentials.some((item) => item.title.toLowerCase() === title.toLowerCase() && item.issuer.toLowerCase() === issuer.toLowerCase());
      if (!exists) {
        credentials.push({ id: randomUUID(), title, issuer, status: "self_declared" });
      }
      current.credentials = credentials;
    }
    return current;
  });
  if (!user) return { ok: false, error: "missing" };
  return { ok: true, user: toPublic(user) };
}

export async function verifyCredential(
  actor: { id: string; admin: boolean },
  userId: string,
  credentialId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!actor.admin) return { ok: false, error: "forbidden" };
  if (!/^[0-9a-f-]{36}$/i.test(credentialId)) return { ok: false, error: "missing" };
  const result = await updateDb((db) => {
    const current = db.users.find((item) => item.id === userId);
    const credential = current?.credentials?.find((item) => item.id === credentialId);
    if (!current || !credential) return "missing" as const;
    if (credential.status !== "verified") {
      credential.status = "verified";
      db.audit = db.audit ?? [];
      db.audit.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        actorId: actor.id,
        action: "credential_verify",
        targetId: current.id,
        detail: credential.id,
      });
    }
    return "ok" as const;
  });
  return result === "ok" ? { ok: true } : { ok: false, error: result };
}

export async function updateConnect(userId: string, connect: ConnectState): Promise<void> {
  await updateDb((db) => {
    const current = db.users.find((item) => item.id === userId);
    if (current) {
      current.connect = connect;
    }
  });
}
