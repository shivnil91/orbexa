import { createHash, timingSafeEqual } from "node:crypto";

export const DEMO_BASIC_AUTH_CHALLENGE = 'Basic realm="Orbexa demo", charset="UTF-8"';

const HEALTH_PATH = "/health";
const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";

export type DemoAuthInput = {
  method: string;
  pathname: string;
  authorization: string | null;
  demoBasicAuth: string | undefined;
};

export type DemoAuthDecision =
  | { allow: true }
  | { allow: false; status: 401; wwwAuthenticate: string };

export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function isDemoAuthExempt(method: string, pathname: string): boolean {
  const path = normalizePath(pathname);
  if (method.toUpperCase() === "GET" && path === HEALTH_PATH) {
    return true;
  }
  return path === STRIPE_WEBHOOK_PATH;
}

/** Read at request time. Bracket access keeps Next from inlining the build-time value. */
export function readDemoBasicAuth(env: Record<string, string | undefined> = process.env): string | undefined {
  return env["DEMO_BASIC_AUTH"];
}

export function isUserPassword(value: string): boolean {
  const separator = value.indexOf(":");
  return separator > 0 && separator < value.length - 1;
}

/** SHA-256 both sides so timingSafeEqual always compares equal-length digests. */
export function credentialsMatch(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function decodeBasicUserPassword(authorization: string | null): string | null {
  if (authorization === null) {
    return null;
  }
  const trimmed = authorization.trim();
  const space = trimmed.indexOf(" ");
  if (space <= 0) {
    return null;
  }
  if (trimmed.slice(0, space).toLowerCase() !== "basic") {
    return null;
  }
  const token = trimmed.slice(space + 1).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token)) {
    return null;
  }
  const decoded = Buffer.from(token, "base64").toString("utf8");
  const canonical = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/u, "");
  if (canonical !== token.replace(/=+$/u, "")) {
    return null;
  }
  return decoded;
}

export function decideDemoAuth(input: DemoAuthInput): DemoAuthDecision {
  const expected = input.demoBasicAuth ?? "";
  if (expected.length === 0) {
    return { allow: true };
  }
  if (isDemoAuthExempt(input.method, input.pathname)) {
    return { allow: true };
  }
  const provided = decodeBasicUserPassword(input.authorization) ?? "";
  if (credentialsMatch(provided, expected) && isUserPassword(expected)) {
    return { allow: true };
  }
  return {
    allow: false,
    status: 401,
    wwwAuthenticate: DEMO_BASIC_AUTH_CHALLENGE,
  };
}
