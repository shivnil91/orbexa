import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
}

async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sign out" });
  if (!(await button.isVisible())) {
    await page.locator("summary").click();
  }
  await button.click();
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
  const skill = `Load checker ${stamp} flags missing bridge load cases`;

  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get expert work done by AI agents built by real experts, from $15, in minutes.");
  await expect(page.getByRole("link", { name: "Get something done" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Earn from your skills" }).first()).toBeVisible();
  await noOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: `/opt/cursor/artifacts/landing-${info.project.name}.png`, fullPage: true });

  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password do not match.")).toBeVisible();

  await page.goto("/en/earn");
  await page.getByLabel("What are you great at?").fill(skill);
  await page.getByRole("button", { name: "Draft my listing" }).click();
  await expect(page.getByRole("heading", { name: "What a buyer would see" })).toBeVisible();
  await expect(page.getByText("You keep 80%")).toBeVisible();
  await page.getByLabel("Title").fill(skill);
  await page.getByLabel("Name", { exact: true }).fill("Seller Example");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.screenshot({ path: `/opt/cursor/artifacts/seller-create-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(skill);
  await expect(page.getByText("You are live.")).toBeVisible();

  await page.goto(`/en/listings?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByRole("heading", { name: skill })).toBeVisible();
  await signOut(page);

  await page.goto("/en/register?role=buyer");
  await page.getByLabel("Name").fill("Buyer Example");
  await page.getByLabel("Email").fill(buyerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("radio", { name: "Buyer" }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.goto(`/en/get?need=${encodeURIComponent(skill)}`);
  const match = page.getByRole("article").filter({ hasText: skill });
  await expect(match.getByRole("heading", { level: 2, name: skill })).toBeVisible();
  await page.screenshot({ path: `/opt/cursor/artifacts/search-results-${info.project.name}.png`, fullPage: true });
  await match.getByRole("button", { name: /Pay .* and get this/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your draft" })).toBeVisible();
  await expect(page.getByText(`You asked: ${skill}`)).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `/opt/cursor/artifacts/hire-checkout-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Accept this draft" }).click();
  await expect(page.getByText("You accepted this draft")).toBeVisible();
  await page.getByLabel("Your rating").selectOption("5");
  await page.getByLabel("Review", { exact: true }).fill("The draft named the request and did not invent a load.");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByText("Your review is on the listing.")).toBeVisible();

  await page.goto("/en/orders");
  await expect(page.getByRole("heading", { level: 2, name: skill })).toBeVisible();
  await signOut(page);

  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/en/sell/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seller dashboard");
  await expect(page.getByText("Your share so far")).toBeVisible();
  await expect(page.getByText("You keep 80%")).toBeVisible();
  await expect(page.getByText(skill).first()).toBeVisible();
  await expect(page.getByText("Accepted").first()).toBeVisible();
  await signOut(page);

  await page.goto("/en/register");
  await page.getByLabel("Name").fill("Operator Example");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByLabel("Operator code").fill("demo-operator-code");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto("/en/admin");
  const row = page.locator("li").filter({ hasText: skill });
  await row.getByRole("button", { name: "Suspend" }).click();
  await page.goto(`/en/listings?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByRole("heading", { name: skill })).toHaveCount(0);
});
