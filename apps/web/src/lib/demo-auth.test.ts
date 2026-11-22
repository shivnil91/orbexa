import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DEMO_BASIC_AUTH_CHALLENGE,
  credentialsMatch,
  decideDemoAuth,
  type DemoAuthDecision,
} from "./demo-auth.ts";

const SECRET = "ada:correct-horse";

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function decide(overrides: Partial<Parameters<typeof decideDemoAuth>[0]> = {}): DemoAuthDecision {
  return decideDemoAuth({
    method: "GET",
    pathname: "/en",
    authorization: null,
    demoBasicAuth: SECRET,
    ...overrides,
  });
}

test("demo auth stays off until DEMO_BASIC_AUTH is set", () => {
  for (const demoBasicAuth of [undefined, ""]) {
    const decision = decide({ demoBasicAuth, authorization: null, pathname: "/en/dashboard" });
    assert.deepEqual(decision, { allow: true });
  }
});

test("a missing or wrong credential is 401 with WWW-Authenticate", () => {
  for (const authorization of [
    null,
    "",
    "Bearer token",
    "Basic",
    basic("ada", "wrong"),
    basic("bob", "correct-horse"),
    basic("ada", "correct-horse-extra"),
    `Basic ${Buffer.from("not-a-pair", "utf8").toString("base64")}`,
  ]) {
    const decision = decide({ authorization });
    assert.deepEqual(decision, {
      allow: false,
      status: 401,
      wwwAuthenticate: DEMO_BASIC_AUTH_CHALLENGE,
    });
  }
});

test("the matching user:password is allowed, including a colon in the password", () => {
  assert.deepEqual(decide({ authorization: basic("ada", "correct-horse") }), { allow: true });
  assert.deepEqual(
    decide({
      method: "POST",
      pathname: "/api/jobs",
      authorization: basic("ada", "p:ass"),
      demoBasicAuth: "ada:p:ass",
    }),
    { allow: true },
  );
  assert.deepEqual(decide({ authorization: `basic ${Buffer.from(SECRET, "utf8").toString("base64")}` }), {
    allow: true,
  });
});

test("credential comparison does not throw when the lengths differ", () => {
  assert.equal(credentialsMatch(SECRET, SECRET), true);
  assert.equal(credentialsMatch("ada:nope", SECRET), false);
  assert.equal(credentialsMatch("ada:correct-horse-and-more", SECRET), false);
  assert.equal(credentialsMatch("", SECRET), false);
});

test("a secret that is not user:password fails closed", () => {
  for (const demoBasicAuth of ["onlypassword", ":password", "user:", ":"]) {
    const decision = decide({
      demoBasicAuth,
      authorization: `Basic ${Buffer.from(demoBasicAuth, "utf8").toString("base64")}`,
    });
    assert.equal(decision.allow, false);
  }
});

test("GET /health and the Stripe webhook stay open when demo auth is on", () => {
  assert.deepEqual(decide({ method: "GET", pathname: "/health", authorization: null }), { allow: true });
  assert.deepEqual(decide({ method: "GET", pathname: "/health/", authorization: null }), { allow: true });
  assert.deepEqual(decide({ method: "get", pathname: "/health", authorization: "Bearer nope" }), { allow: true });
  assert.deepEqual(decide({ method: "POST", pathname: "/health", authorization: null }).allow, false);
  assert.deepEqual(decide({ method: "POST", pathname: "/api/stripe/webhook", authorization: null }), {
    allow: true,
  });
  assert.deepEqual(decide({ method: "GET", pathname: "/api/stripe/webhook/", authorization: null }), {
    allow: true,
  });
  assert.equal(decide({ method: "POST", pathname: "/api/stripe/webhook/replay", authorization: null }).allow, false);
  assert.equal(decide({ method: "GET", pathname: "/api/jobs", authorization: null }).allow, false);
  for (const pathname of ["/api/auth/sign-in", "/api/auth/register", "/api/admin/listings", "/api/connect", "/api/reviews", "/en/admin", "/api/jobs"]) {
    assert.equal(decide({ method: "POST", pathname, authorization: null }).allow, false, pathname);
  }
});

test("the proxy runs the check and does not skip health or API routes", () => {
  const source = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
  assert.match(source, /decideDemoAuth/);
  assert.match(source, /readDemoBasicAuth/);
  assert.match(source, /csrfAllows/);
  assert.doesNotMatch(source, /process\.env\.DEMO_BASIC_AUTH/);
  const matcher = source.slice(source.indexOf("matcher"));
  assert.equal(matcher.includes("health"), false);
  assert.equal(matcher.includes("api"), false);
});
