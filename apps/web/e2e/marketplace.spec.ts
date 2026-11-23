import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test("seller publishes, buyer hires, and admin can hide the listing", async ({ page }, info) => {
  test.setTimeout(180_000);
  const stamp = `${info.project.name}-${Date.now()}`;
  const sellerEmail = `seller-${stamp}@example.test`;
  const buyerEmail = `buyer-${stamp}@example.test`;
  const adminEmail = `admin-${info.project.name}@example.test`;
  const agentName = `Load checker ${stamp}`;

  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Expert know-how, packaged as AI you can trust.");
  await expect(page.getByRole("heading", { name: "Why not just ask ChatGPT?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a seller agent" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a buyer/search agent" })).toBeVisible();
  await noOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: `/opt/cursor/artifacts/landing-${info.project.name}.png`, fullPage: true });

  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password do not match.")).toBeVisible();

  await page.goto("/en/register?role=seller");
  await page.getByLabel("Name").fill("Seller Example");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("radio", { name: "Seller" }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sell on Orbexa");
  await page.getByRole("link", { name: "Build an agent" }).click();
  await page.getByLabel("Agent name").fill(agentName);
  await page.getByLabel("Short pitch").fill("Flag missing bridge load cases");
  await page.getByLabel("Description").fill("Looks through a short brief for missing load combinations.");
  await page.getByLabel("Category").selectOption("engineering");
  await page.getByLabel("Instructions").fill("Flag missing load cases. Do not invent a number.");
  await page.getByRole("textbox", { name: "Knowledge notes" }).fill("Load case LC2 must be named before a result is given. Do not invent a measurement.");
  await page.getByRole("textbox", { name: "Checklist", exact: true }).fill("Name every missing load case. Leave a blank where the number is absent.");
  await page.getByLabel("What does a good result include, as checks you can point to?").fill("Name each missing load case and leave the number blank.");
  await page.getByLabel("What must the draft never invent or assume?").fill("Never invent a measurement or a certificate.");
  await page.getByLabel("What do you look at first, and what do you ignore?").fill("Look at the named cases first and ignore a guessed total.");
  await page.getByLabel("What mistake does a general model make on this work?").fill("A general model fills a missing load case with a plausible number.");
  await page.getByLabel("What rule do you use when the brief is incomplete?").fill("When the brief is incomplete, mark the item missing.");
  if (info.project.name === "mobile") {
    await page.getByRole("region", { name: "Knowledge inside" }).screenshot({ path: "/opt/cursor/artifacts/seller-knowledge-mobile.png" });
  }
  await page.getByLabel("Example output title").fill("Sample note");
  await page.getByLabel("Example output", { exact: true }).fill("LC2 is not named in the brief. No load was invented.");
  await page.getByLabel("Starting price (USD)").fill("40");
  await page.getByLabel("Sample request for the test run").fill("Check bridge load case LC2");
  await page.screenshot({ path: `/opt/cursor/artifacts/seller-create-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Test run" }).click();
  await expect(page.getByText("Demo fixture").first()).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Status: draft")).toBeVisible();
  const editor = page.url();

  await page.goto(`/en/listings?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByRole("heading", { name: agentName })).toHaveCount(0);
  await page.goto(editor);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(agentName);
  await expect(page.getByText(/Beats plain AI in \d+\/10 tests/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible();
  await expect(page.getByText("SECRET")).toHaveCount(0);
  await expect(page.getByText("Load case LC2 must be named before a result is given")).toHaveCount(0);
  if (info.project.name === "mobile") {
    await page.getByRole("region", { name: "Orbexa Proof" }).screenshot({ path: "/opt/cursor/artifacts/listing-proof-mobile.png" });
    await page.locator("article").filter({ hasText: "Plain AI" }).first().screenshot({ path: "/opt/cursor/artifacts/proof-side-by-side-mobile.png" });
  }

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/en/register?role=buyer");
  await page.getByLabel("Name").fill("Buyer Example");
  await page.getByLabel("Email").fill(buyerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("radio", { name: "Buyer" }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.goto("/en/search");
  await page.getByLabel("What do you need?").fill(agentName);
  await page.getByRole("button", { name: "Find agents" }).click();
  await expect(page.getByRole("heading", { level: 3, name: agentName })).toBeVisible();
  await page.screenshot({ path: `/opt/cursor/artifacts/search-results-${info.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: `Hire ${agentName}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Intake");
  await page.getByRole("button", { name: "Review the order" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Checkout");
  await expect(page.getByText("Simulated checkout")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `/opt/cursor/artifacts/hire-checkout-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Confirm simulated payment" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run");
  await expect(page.getByText("Demo fixture").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Review the deliverable" }).click();
  await page.getByRole("button", { name: "Accept deliverable" }).click();
  await expect(page.getByText("buyer_approve")).toBeVisible();
  await page.getByLabel("Your rating").selectOption("5");
  await page.getByLabel("Review", { exact: true }).fill("The fixture named the missing load case and did not invent one.");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByText("Your review is on the listing.")).toBeVisible();

  await page.goto(`/en/listings?q=${encodeURIComponent(agentName)}`);
  await page.getByRole("link", { name: agentName }).first().click();
  await page.getByRole("link", { name: "Continue with Autonomous" }).click();
  await page.getByLabel("What should this agent do?").fill("Check the missing load case");
  await page.getByRole("button", { name: "Review the order" }).click();
  await page.getByRole("button", { name: "Confirm simulated payment" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run");
  await expect(page.getByText("Demo fixture").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Review the deliverable" }).click();
  await page.getByLabel("Reason for rejection").fill("The missing load case is still not named.");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Free revision is ready.")).toBeVisible();
  await page.getByLabel("Reason for rejection").fill("The revision still does not name the missing case.");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Refund requested.")).toBeVisible();

  await page.goto("/en/orders");
  await expect(page.getByRole("heading", { level: 2, name: agentName }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/en/sell/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seller dashboard");
  await expect(page.getByText("Demo ledger")).toBeVisible();
  await expect(page.getByText(agentName).first()).toBeVisible();
  await expect(page.getByText("Accepted").first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.goto("/en/register");
  await page.getByLabel("Name").fill("Operator Example");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByLabel("Operator code").fill("demo-operator-code");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto("/en/admin");
  const row = page.locator("li").filter({ hasText: agentName }).filter({ has: page.getByRole("button", { name: "Suspend" }) });
  const refund = page.locator("li").filter({ hasText: agentName }).filter({ hasText: "The revision still does not name the missing case." });
  await refund.getByRole("button", { name: "Approve refund" }).click();
  await expect(page.getByText("refund_approve").first()).toBeVisible();
  await row.getByRole("button", { name: "Suspend" }).click();
  await page.goto(`/en/listings?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByRole("heading", { name: agentName })).toHaveCount(0);
});
