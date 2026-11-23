import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { hashPassword, operatorCodeMatches, registerAccount, safeNext, sessionCookie, signInAccount, updateAccount, userFromToken, verifyPassword, type PublicUser } from "./accounts.ts";
import { syncConnectAccount } from "./connect.ts";
import { readDb } from "./demo-store.ts";
import { buyerOrders, canMutateJob, canReadJob, orderSummary, sellerOrders } from "./job-access.ts";
import { addReview, moderateListing, saveAgent } from "./marketplace.ts";
import { browserOrigin, csrfAllows, sameOriginUrl } from "./request-guard.ts";

const BUYER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEMO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function headers(values: Record<string, string | null>): { get(name: string): string | null } {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

test("redirects stay on the browser host and ignore a forged forwarded host", () => {
  const request = {
    url: "http://localhost:3000/en",
    headers: headers({ host: "127.0.0.1:3456", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" }),
  };
  assert.equal(browserOrigin(request, {}), "http://127.0.0.1:3456");
  assert.equal(sameOriginUrl("http://127.0.0.1:3456", "//evil.example/phish").host, "127.0.0.1:3456");
  assert.equal(sameOriginUrl("http://127.0.0.1:3456", "/\\evil.example").pathname, "/");
  const previous = process.env.ORBEXA_PUBLIC_ORIGIN;
  process.env.ORBEXA_PUBLIC_ORIGIN = "https://demo.example";
  try {
    assert.equal(browserOrigin(request), "https://demo.example");
  } finally {
    if (previous === undefined) delete process.env.ORBEXA_PUBLIC_ORIGIN;
    else process.env.ORBEXA_PUBLIC_ORIGIN = previous;
  }
});

test("cookie mutations require the browser origin, and the Stripe webhook stays exempt", () => {
  const browser = "http://127.0.0.1:3456";
  assert.equal(csrfAllows({ method: "GET", pathname: "/en", origin: null, referer: null, browserOrigin: browser }), true);
  assert.equal(csrfAllows({ method: "POST", pathname: "/api/stripe/webhook", origin: null, referer: null, browserOrigin: browser }), true);
  assert.equal(csrfAllows({ method: "POST", pathname: "/api/auth/sign-in", origin: browser, referer: null, browserOrigin: browser }), true);
  assert.equal(csrfAllows({ method: "POST", pathname: "/api/jobs/abc/checkout", origin: "https://evil.example", referer: null, browserOrigin: browser }), false);
  assert.equal(csrfAllows({ method: "POST", pathname: "/api/admin/listings", origin: null, referer: null, browserOrigin: browser }), false);
  assert.equal(csrfAllows({ method: "POST", pathname: "/api/connect", origin: null, referer: `${browser}/en/sell`, browserOrigin: browser }), true);
});

test("session cookies are host-only and gain Secure only on https", () => {
  const secure = sessionCookie("token", true);
  assert.equal(secure.httpOnly, true);
  assert.equal(secure.sameSite, "lax");
  assert.equal(secure.path, "/");
  assert.equal(secure.secure, true);
  assert.equal("domain" in secure, false);
  assert.equal(sessionCookie("token", false).secure, false);
  assert.equal(safeNext("//evil.example", "en"), "/en/account");
  assert.equal(safeNext("/en//evil.example", "en"), "/en/account");
  assert.equal(safeNext("/en/sell?next=1", "en"), "/en/sell?next=1");
  assert.equal(safeNext("/en/sell\\@evil", "en"), "/en/account");
});

test("a buyer cannot read or change another buyer's order", () => {
  assert.equal(canReadJob(DEMO, null), true);
  assert.equal(canMutateJob(DEMO, null), true);
  assert.equal(canReadJob(BUYER, null), false);
  assert.equal(canMutateJob(BUYER, { id: OTHER }), false);
  assert.equal(canReadJob(BUYER, { id: OTHER, admin: true }), true);
  assert.equal(canMutateJob(BUYER, { id: OTHER, admin: true }), false);
  assert.equal(canMutateJob(BUYER, { id: BUYER }), true);
  const jobs = [
    { id: "1", tenantId: BUYER, sellerId: "seller", listingSlug: "mine", title: "Mine", status: "accepted", priceMinor: 100, currency: "USD", opportunityName: "secret need" },
    { id: "2", tenantId: OTHER, sellerId: "other", listingSlug: "theirs", title: "Theirs", status: "accepted", priceMinor: 100, currency: "USD", opportunityName: "other need" },
  ];
  assert.deepEqual(buyerOrders(jobs, BUYER).map((job) => job.id), ["1"]);
  assert.deepEqual(sellerOrders(jobs, "seller", ["mine"]).map((job) => job.id), ["1"]);
  assert.deepEqual(sellerOrders([...jobs, { id: "3", tenantId: OTHER, sellerId: "other", listingSlug: "mine", title: "Shared slug", status: "waiting_for_expert", priceMinor: 100, currency: "USD", opportunityName: "other brief" }], "seller", ["mine"]).map((job) => job.id), ["1"]);
  const summary = orderSummary(jobs[0]);
  assert.equal("opportunityName" in summary, false);
  assert.equal(JSON.stringify(summary).includes("secret need"), false);
});

test("listing and review pages do not inject HTML", async () => {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".tsx") || (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))) {
        files.push(full);
      }
    }
  };
  await walk(path.join(process.cwd(), "src"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(source.includes("dangerouslySetInnerHTML"), false, file);
    assert.equal(source.includes(".innerHTML"), false, file);
    if (source.startsWith('"use client"') || source.includes('\n"use client"')) {
      const valueImport = source.split("\n").some((line) => /from ["']@\/lib\/(model|jobs|payments)["']/.test(line) && !line.trimStart().startsWith("import type"));
      assert.equal(valueImport, false, file);
    }
  }
});

test("job routes check the buyer and checkout does not take a destination account", async () => {
  for (const file of [
    "src/app/api/jobs/[id]/step/route.ts",
    "src/app/api/jobs/[id]/feedback/route.ts",
    "src/app/api/jobs/[id]/signal/route.ts",
    "src/app/api/jobs/[id]/consent/route.ts",
    "src/app/api/jobs/[id]/checkout/route.ts",
    "src/app/api/jobs/[id]/deliver/route.ts",
    "src/app/api/jobs/[id]/refund/route.ts",
  ]) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    assert.match(source, /canMutateJob/);
  }
  const checkout = await readFile(path.join(process.cwd(), "src/app/api/jobs/[id]/checkout/route.ts"), "utf8");
  assert.equal(checkout.includes("destinationAccountId"), false);
  assert.equal(checkout.includes("form.get(\"amount"), false);
  const refund = await readFile(path.join(process.cwd(), "src/app/api/jobs/[id]/refund/route.ts"), "utf8");
  assert.match(refund, /form\.get\("amount"\)/);
  assert.match(refund, /destinationAccountId/);
  assert.equal(refund.includes("console."), false);
  const deliver = await readFile(path.join(process.cwd(), "src/app/api/jobs/[id]/deliver/route.ts"), "utf8");
  assert.equal(deliver.includes("console."), false);
  assert.equal(deliver.includes("ANTHROPIC_API_KEY"), false);
  const sandbox = await readFile(path.join(process.cwd(), "src/app/api/agents/sandbox/route.ts"), "utf8");
  assert.equal(sandbox.includes("draftDeliverable"), false);
  assert.equal(sandbox.includes("@/lib/model"), false);
  assert.match(sandbox, /sandboxReply/);
  const events = await readFile(path.join(process.cwd(), "src/app/api/jobs/[id]/events/route.ts"), "utf8");
  assert.match(events, /canReadJob/);
  const hire = await readFile(path.join(process.cwd(), "src/app/api/jobs/route.ts"), "utf8");
  assert.match(hire, /!item\.example/);
  const proof = await readFile(path.join(process.cwd(), "src/app/api/agents/proof/route.ts"), "utf8");
  assert.match(proof, /currentUser/);
  assert.match(proof, /queueProofRerun\(user\.id/);
  assert.equal(proof.split("scheduleProof(").length - 1, 1);
  const publicProof = await readFile(path.join(process.cwd(), "src/app/api/listings/[slug]/proof/route.ts"), "utf8");
  assert.equal(publicProof.includes("scheduleProof"), false);
  const refunds = await readFile(path.join(process.cwd(), "src/app/api/admin/refunds/route.ts"), "utf8");
  assert.match(refunds, /user\?\.admin/);
  const credentials = await readFile(path.join(process.cwd(), "src/app/api/admin/credentials/route.ts"), "utf8");
  assert.match(credentials, /user\?\.admin/);
  const expert = await readFile(path.join(process.cwd(), "src/app/api/jobs/[id]/expert-draft/route.ts"), "utf8");
  assert.match(expert, /user\.id/);
});

describe("accounts, suspension, and connect status", { concurrency: false }, () => {
  test("passwords are salted hashes, sessions rotate, and unknown emails use the same error", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-security-"));
    const previous = process.env.ORBEXA_DEMO_DIR;
    process.env.ORBEXA_DEMO_DIR = directory;
    try {
      const created = await registerAccount({ name: "Ada", email: "ada-security@example.com", password: "correct-horse", role: "buyer" });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const raw = await readFile(path.join(directory, "marketplace.json"), "utf8");
      assert.equal(raw.includes("correct-horse"), false);
      assert.equal(raw.includes(created.token), false);
      const stored = (await readDb()).users[0];
      assert.equal(verifyPassword("correct-horse", stored?.passwordSalt ?? "", stored?.passwordHash ?? ""), true);
      assert.notEqual(hashPassword("correct-horse").salt, hashPassword("correct-horse").salt);
      const missing = await signInAccount("missing-security@example.com", "correct-horse");
      const wrong = await signInAccount("ada-security@example.com", "wrong-password");
      assert.equal(missing.ok, false);
      assert.equal(wrong.ok, false);
      if (!missing.ok && !wrong.ok) {
        assert.equal(missing.error, wrong.error);
      }
      const first = await signInAccount("ada-security@example.com", "correct-horse");
      const second = await signInAccount("ada-security@example.com", "correct-horse");
      assert.equal(first.ok && second.ok, true);
      if (first.ok && second.ok) {
        assert.notEqual(first.token, second.token);
        assert.equal(await userFromToken(first.token), null);
        assert.equal((await userFromToken(second.token))?.email, "ada-security@example.com");
      }
      const role = await updateAccount(created.user.id, { name: "Ada", bio: "", role: "admin" });
      assert.equal(role.ok, false);
    } finally {
      if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
      else process.env.ORBEXA_DEMO_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("an allowlisted email is not an operator without the bootstrap code", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-admin-"));
    const previous = {
      dir: process.env.ORBEXA_DEMO_DIR,
      emails: process.env.ORBEXA_ADMIN_EMAILS,
      code: process.env.ORBEXA_ADMIN_BOOTSTRAP,
    };
    process.env.ORBEXA_DEMO_DIR = directory;
    process.env.ORBEXA_ADMIN_EMAILS = "operator@example.com";
    process.env.ORBEXA_ADMIN_BOOTSTRAP = "demo-operator-code";
    try {
      assert.equal(operatorCodeMatches("short", process.env), false);
      const blocked = await registerAccount({ name: "Op", email: "operator@example.com", password: "correct-horse", role: "both" });
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error, "operator");
      const person = await registerAccount({ name: "Pat", email: "pat@example.com", password: "correct-horse", role: "buyer", operatorCode: "demo-operator-code" });
      assert.equal(person.ok, true);
      if (person.ok) assert.equal(person.user.admin, false);
      const admin = await registerAccount({ name: "Op", email: "operator@example.com", password: "correct-horse", role: "both", operatorCode: "demo-operator-code" });
      assert.equal(admin.ok, true);
      if (!admin.ok) return;
      assert.equal(admin.user.admin, true);
      process.env.ORBEXA_ADMIN_BOOTSTRAP = "tiny";
      assert.equal(operatorCodeMatches("tiny"), false);
      const squatter = await registerAccount({ name: "Other", email: "operator@example.com", password: "correct-horse", role: "buyer", operatorCode: "tiny" });
      assert.equal(squatter.ok, false);
    } finally {
      if (previous.dir === undefined) delete process.env.ORBEXA_DEMO_DIR;
      else process.env.ORBEXA_DEMO_DIR = previous.dir;
      if (previous.emails === undefined) delete process.env.ORBEXA_ADMIN_EMAILS;
      else process.env.ORBEXA_ADMIN_EMAILS = previous.emails;
      if (previous.code === undefined) delete process.env.ORBEXA_ADMIN_BOOTSTRAP;
      else process.env.ORBEXA_ADMIN_BOOTSTRAP = previous.code;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a seller cannot publish over an operator suspension", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-suspend-"));
    const previous = process.env.ORBEXA_DEMO_DIR;
    process.env.ORBEXA_DEMO_DIR = directory;
    try {
      const created = await registerAccount({ name: "Seller", email: "seller-security@example.com", password: "correct-horse", role: "seller" });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const input = {
        name: "Load checker",
        pitch: "Flag missing bridge load cases",
        description: "Looks for missing load combinations in a short brief.",
        category: "engineering",
        instructions: "Flag missing load cases and do not invent numbers.",
        knowledge: [],
        exampleTitle: "Sample",
        exampleBody: "LC2 is missing from the brief.",
        priceRaw: "40",
        interview: [
          { questionId: "good", answer: "Name each missing load case and leave the number blank." },
          { questionId: "never", answer: "Never invent a measurement or a certificate." },
          { questionId: "first", answer: "Look at the named cases first and ignore a guessed total." },
          { questionId: "mistake", answer: "A general model fills a gap with a plausible number." },
          { questionId: "incomplete", answer: "When the brief is incomplete, mark the item missing." },
        ],
      };
      const saved = await saveAgent(created.user.id, input, "publish");
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      assert.equal(await moderateListing(saved.slug, "suspend"), true);
      const again = await saveAgent(created.user.id, input, "publish", saved.slug);
      assert.equal(again.ok, false);
      if (!again.ok) assert.equal(again.error, "suspended");
      assert.equal(await moderateListing("__proto__", "suspend"), false);
      assert.equal(await moderateListing("../secret", "suspend"), false);
      const db = await readDb();
      assert.equal(db.overrides[saved.slug], "suspended");
      const savedReview = await addReview({
        agentSlug: saved.slug,
        jobId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        buyerId: BUYER,
        buyerName: "Buyer <script>",
        rating: 5,
        body: "<script>alert(1)</script>",
      });
      assert.equal(savedReview.ok, true);
      const review = (await readDb()).reviews[0];
      assert.equal(review?.body, "<script>alert(1)</script>");
    } finally {
      if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
      else process.env.ORBEXA_DEMO_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("Connect charges stay off until Stripe reports them for this user", async () => {
    const user: PublicUser = {
      id: "44444444-4444-4444-8444-444444444444",
      email: "seller@example.com",
      name: "Seller",
      bio: "",
      role: "seller",
      admin: false,
      connect: { mode: "stripe_test", accountId: "acct_test123", chargesEnabled: true, detailsSubmitted: true },
      experience: "",
      links: [],
      credentials: [],
      trainingConsent: false,
      photoDataUrl: "",
    };
    const env = { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example", STRIPE_TEST_NETWORK: "1" };
    const off = await syncConnectAccount({ user, env: {}, transport: async () => ({ status: 200, body: "{}" }) });
    assert.equal(off.chargesEnabled, false);
    const mismatch = await syncConnectAccount({
      user,
      env,
      transport: async () => ({
        status: 200,
        body: JSON.stringify({ id: "acct_test123", livemode: false, charges_enabled: true, details_submitted: true, metadata: { user_id: "someone-else" } }),
      }),
    });
    assert.equal(mismatch.chargesEnabled, false);
    const live = await syncConnectAccount({
      user,
      env,
      transport: async () => ({
        status: 200,
        body: JSON.stringify({ id: "acct_test123", livemode: true, charges_enabled: true, details_submitted: true, metadata: { user_id: user.id } }),
      }),
    });
    assert.equal(live.chargesEnabled, false);
    const ready = await syncConnectAccount({
      user,
      env,
      transport: async (call) => {
        assert.equal(call.method, "GET");
        assert.equal(call.url, "https://api.stripe.com/v1/accounts/acct_test123");
        return {
          status: 200,
          body: JSON.stringify({ id: "acct_test123", livemode: false, charges_enabled: true, details_submitted: true, metadata: { user_id: user.id } }),
        };
      },
    });
    assert.equal(ready.chargesEnabled, true);
    assert.equal(ready.detailsSubmitted, true);
  });
});
