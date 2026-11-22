import { normalizePath } from "./demo-auth.ts";

const HOST = /^[A-Za-z0-9.\-:]+$/;

export function browserOrigin(
  request: { url: string; headers: { get(name: string): string | null } },
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.ORBEXA_PUBLIC_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
      }
      if (url.origin !== configured && `${url.origin}/` !== configured) {
        return null;
      }
      return url.origin;
    } catch {
      return null;
    }
  }
  let current: URL;
  try {
    current = new URL(request.url);
  } catch {
    return null;
  }
  const hostHeader = request.headers.get("host");
  const host = hostHeader && HOST.test(hostHeader) ? hostHeader : current.host;
  if (!HOST.test(host)) {
    return null;
  }
  let proto = current.protocol.replace(":", "");
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https" || forwarded === "http") {
    proto = forwarded;
  }
  if (proto !== "https" && proto !== "http") {
    return null;
  }
  return `${proto}://${host}`;
}

export function sameOriginUrl(origin: string, path: string): URL {
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    return new URL("/", `${origin}/`);
  }
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) {
    return new URL("/", `${origin}/`);
  }
  return url;
}

export function requestIsSecure(
  request: { url: string; headers: { get(name: string): string | null } },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return browserOrigin(request, env)?.startsWith("https://") === true;
}

export function csrfAllows(input: {
  method: string;
  pathname: string;
  origin: string | null;
  referer: string | null;
  browserOrigin: string | null;
}): boolean {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  if (normalizePath(input.pathname) === "/api/stripe/webhook") {
    return true;
  }
  if (!input.browserOrigin) {
    return false;
  }
  const source = input.origin && input.origin !== "null" ? input.origin : input.referer;
  if (!source) {
    return false;
  }
  try {
    return new URL(source).origin === input.browserOrigin;
  } catch {
    return false;
  }
}
