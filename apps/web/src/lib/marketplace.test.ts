import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { registerAccount, safeNext, signInAccount, userFromToken } from "./accounts.ts";
import { beginConnectOnboarding } from "./connect.ts";
import { emptyDb, readDb } from "./demo-store.ts";
import {
  acceptedEarnings,
  applyRunCounts,
  browseCatalog,
  buildCatalog,
  recommend,
  sandboxReply,
  saveAgent,
  scoreMatch,
  tiersForPrice,
  validateAgent,
} from "./marketplace.ts";
import { checkoutPlan } from "./payments.ts";
import type { PublicUser } from "./accounts.ts";

const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("search ranks a drawing request above unrelated agents", () => {
  const items = buildCatalog(emptyDb());
  const drawing = items.find((item) => item.slug === "example-drawing-check");
  const support = items.find((item) => item.slug === "example-support-reply");
  if (!drawing || !support) {
    throw new Error("example agents missing");
  }
  assert.ok(scoreMatch("missing dimensions on a structural drawing", drawing) > scoreMatch("missing dimensions on a structural drawing", support));
  const ranked = recommend("draft a limitation clause", items);
  assert.equal(ranked[0]?.item.slug, "example-clause-drafter");
  assert.match(ranked[0]?.reason ?? "", /clause|limitation|legal/i);
  assert.equal(scoreMatch("   ", drawing), 0);
});

test("browse filters category, price, and rating, then paginates", () => {
  const items = buildCatalog(emptyDb());
  const engineering = browseCatalog(items, { category: "engineering" });
  assert.equal(engineering.total, 1);
  assert.equal(engineering.items[0]?.slug, "example-drawing-check");
  const cheap = browseCatalog(items, { maxPrice: 2000 });
  assert.ok(cheap.items.every((item) => item.priceMinor <= 2000));
  assert.ok(cheap.items.some((item) => item.slug === "example-support-reply"));
  const high = browseCatalog(items, { minRating: 5 });
  assert.ok(high.items.some((item) => item.slug === "example-interface-critique"));
  assert.equal(high.items.some((item) => item.slug === "example-clause-drafter"), false);
  const page = browseCatalog(items, { sort: "newest", page: 2 }, 6);
  assert.equal(page.page, 2);
  assert.equal(page.pages, 2);
  assert.equal(page.items.length, items.filter((item) => item.status === "published").length - 6);
});

test("a draft stays out of the public catalog and a suspension hides an example", () => {
  const draft = buildCatalog({
    ...emptyDb(),
    users: [],
    agents: [{
      id: "22222222-2222-4222-8222-222222222222",
      slug: "private-draft",
      ownerId: "33333333-3333-4333-8333-333333333333",
      name: "Private draft",
      pitch: "Not published yet",
      description: "Hidden until publish",
      category: "writing",
      instructions: "Stay hidden until the seller publishes.",
      knowledge: [],
      exampleOutputs: [],
      priceMinor: 2500,
      currency: "USD",
      status: "draft",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      publishedAt: null,
    }],
    overrides: { "example-support-reply": "suspended" },
  });
  assert.equal(draft.some((item) => item.slug === "private-draft" && item.status === "draft"), true);
  assert.equal(browseCatalog(draft, {}).items.some((item) => item.slug === "private-draft"), false);
  assert.equal(browseCatalog(draft, {}).items.some((item) => item.slug === "example-support-reply"), false);
});

test("generated tiers balance and live runs replace example run counts", () => {
  for (const tier of tiersForPrice(4000)) {
    const plan = checkoutPlan({
      orderId: ORDER,
      amountMinor: tier.priceMinor,
      currency: "USD",
      reviewFeeMinor: tier.reviewFeeMinor,
      platformFeeBps: tier.platformFeeBps,
    });
    assert.equal(plan.platformFeeMinor + plan.creatorRoyaltyMinor + plan.reviewFeeMinor, tier.priceMinor);
  }
  const [first] = applyRunCounts(buildCatalog(emptyDb()), { "example-drawing-check": 2 });
  const drawing = applyRunCounts(buildCatalog(emptyDb()), { "example-drawing-check": 2 }).find((item) => item.slug === "example-drawing-check");
  assert.equal(drawing?.runs, 2);
  assert.equal(drawing?.runsExample, false);
  assert.equal(first?.slug.length > 0, true);
});

test("the sandbox reply is labeled as a fixture and quotes the request", () => {
  const paragraphs = sandboxReply({ name: "Load checker", instructions: "Flag missing load cases.", knowledge: "LC2", need: "Check bridge load case LC2" });
  assert.match(paragraphs[0] ?? "", /Demo fixture/);
  assert.match(paragraphs.join("\n"), /Check bridge load case LC2/);
  assert.match(paragraphs.join("\n"), /Flag missing load cases/);
});

test("publish validation rejects a short instruction and accepts a complete agent", () => {
  const input = {
    name: "Load checker",
    pitch: "Flag missing bridge load cases",
    description: "Looks for missing load combinations in a short brief.",
    category: "engineering",
    instructions: "Flag missing load cases and do not invent numbers.",
    knowledge: [],
    exampleTitle: "Sample",
    exampleBody: "LC2 is not in the brief. No load was invented.",
    priceRaw: "40",
    interview: [
      { questionId: "good", answer: "Name each missing load case and leave the number blank." },
      { questionId: "never", answer: "Never invent a measurement or a certificate." },
      { questionId: "first", answer: "Look at the named cases first and ignore a guessed total." },
      { questionId: "mistake", answer: "A general model fills a gap with a plausible number." },
      { questionId: "incomplete", answer: "When the brief is incomplete, mark the item missing." },
    ],
  };
  assert.equal(validateAgent({ ...input, instructions: "too short" }, "publish").ok, false);
  const saved = validateAgent(input, "publish");
  assert.equal(saved.ok, true);
    if (saved.ok) {
    assert.equal(saved.value.priceMinor, 4000);
  }
  const thin = validateAgent({
    ...input,
    interview: [
      { questionId: "good", answer: "aaaaaaaa" },
      { questionId: "never", answer: "bbbbbbbb" },
      { questionId: "first", answer: "cccccccc" },
      { questionId: "mistake", answer: "dddddddd" },
    ],
  }, "publish");
  assert.equal(thin.ok, false);
});

test("open redirects are refused", () => {
  assert.equal(safeNext("https://evil.example/phish", "en"), "/en/account");
  assert.equal(safeNext("//evil.example", "en"), "/en/account");
  assert.equal(safeNext("/en/sell", "en"), "/en/sell");
  assert.equal(safeNext("/fr/sell", "en"), "/en/account");
});

test("accepted earnings sum only this seller's accepted orders", () => {
  const total = acceptedEarnings([
    { sellerId: "seller", listingSlug: "a", status: "accepted", creatorRoyaltyMinor: 3200 },
    { sellerId: "seller", listingSlug: "a", status: "checkout", creatorRoyaltyMinor: 1000 },
    { sellerId: "other", listingSlug: "b", status: "accepted", creatorRoyaltyMinor: 900 },
    { sellerId: "seller", listingSlug: "a", status: "accepted", creatorRoyaltyMinor: 500, refunded: true },
  ], "seller", ["a"]);
  assert.equal(total, 3200);
});

describe("accounts and connect", { concurrency: false }, () => {
  test("register, reject a duplicate, and sign in", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orbexa-accounts-"));
    const previous = process.env.ORBEXA_DEMO_DIR;
    process.env.ORBEXA_DEMO_DIR = directory;
    try {
      const created = await registerAccount({ name: "Ada", email: "ada@example.com", password: "correct-horse", role: "both" });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const again = await registerAccount({ name: "Ada", email: "ada@example.com", password: "correct-horse", role: "buyer" });
      assert.equal(again.ok, false);
      const wrong = await signInAccount("ada@example.com", "nope-nope");
      assert.equal(wrong.ok, false);
      const signed = await signInAccount("ada@example.com", "correct-horse");
      assert.equal(signed.ok, true);
      if (!signed.ok) return;
      const user = await userFromToken(signed.token);
      assert.equal(user?.email, "ada@example.com");
      assert.equal(user?.role, "both");
      const published = await saveAgent(created.user.id, {
        name: "Bridge loads",
        pitch: "Flag missing bridge load cases",
        description: "A seller agent for load combinations.",
        category: "engineering",
        instructions: "Flag missing load cases and do not invent numbers.",
        knowledge: [],
        exampleTitle: "Sample",
        exampleBody: "LC2 is missing from the brief.",
        priceRaw: "40",
      }, "draft");
      assert.equal(published.ok, true);
      if (!published.ok) return;
      assert.equal(buildCatalog(await readDb()).some((item) => item.slug === published.slug && item.status === "draft"), true);
    } finally {
      if (previous === undefined) delete process.env.ORBEXA_DEMO_DIR;
      else process.env.ORBEXA_DEMO_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("connect stays local unless the Stripe test network is enabled", async () => {
    const user: PublicUser = {
      id: "44444444-4444-4444-8444-444444444444",
      email: "seller@example.com",
      name: "Seller",
      bio: "",
      role: "seller",
      admin: false,
      connect: { mode: "simulated", accountId: null, chargesEnabled: false, detailsSubmitted: false },
      experience: "",
      links: [],
      credentials: [],
      trainingConsent: false,
      photoDataUrl: "",
    };
    let calls = 0;
    const simulated = await beginConnectOnboarding({
      user,
      env: {},
      transport: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
      returnUrl: "http://127.0.0.1/en/sell/dashboard",
      refreshUrl: "http://127.0.0.1/en/sell/dashboard",
    });
    assert.equal(calls, 0);
    assert.equal(simulated.mode, "simulated");
    await assert.rejects(
      () => beginConnectOnboarding({
        user,
        env: { STRIPE_SECRET_KEY: "sk_live_nope" },
        transport: async () => ({ status: 200, body: "{}" }),
        returnUrl: "http://127.0.0.1/en/sell/dashboard",
        refreshUrl: "http://127.0.0.1/en/sell/dashboard",
      }),
      /live Stripe/,
    );
    const started = await beginConnectOnboarding({
      user,
      env: { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example", STRIPE_TEST_NETWORK: "1" },
      transport: async (call) => {
        calls += 1;
        if (call.url.endsWith("/accounts")) {
          return { status: 200, body: JSON.stringify({ id: "acct_test123", livemode: false }) };
        }
        return { status: 200, body: JSON.stringify({ url: "https://connect.stripe.com/setup/s/test", livemode: false }) };
      },
      returnUrl: "http://127.0.0.1/en/sell/dashboard",
      refreshUrl: "http://127.0.0.1/en/sell/dashboard",
    });
    assert.equal(started.mode, "stripe_test");
    assert.equal(started.accountId, "acct_test123");
    assert.equal(started.url, "https://connect.stripe.com/setup/s/test");
    assert.equal(started.chargesEnabled, false);
    const before = calls;
    const phish = await beginConnectOnboarding({
      user,
      env: { PAYMENT_PROVIDER: "stripe", STRIPE_TEST_SECRET_KEY: "sk_test_example", STRIPE_TEST_NETWORK: "1" },
      transport: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
      returnUrl: "https://evil.example/phish",
      refreshUrl: "https://evil.example/phish",
      expectedOrigin: "http://127.0.0.1",
    });
    assert.equal(phish.url, null);
    assert.equal(phish.error, "url");
    assert.equal(calls, before);
  });
});
