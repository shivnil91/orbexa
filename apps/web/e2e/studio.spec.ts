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

async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sign out" });
  if (!(await button.isVisible())) await page.locator("summary").click();
  await button.click();
}

test("studio build, bench, publish, hire, and report", async ({ page }, info) => {
  test.setTimeout(180_000);
  const stamp = `${info.project.name}-${Date.now()}`;
  const sellerEmail = `studio-seller-${stamp}@example.test`;
  const buyerEmail = `studio-buyer-${stamp}@example.test`;
  const name = `NDIS desk ${stamp}`;

  await page.goto("/en/register?role=seller");
  await page.getByLabel("Name").fill("Studio Seller");
  await page.getByLabel("Email").fill(sellerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("radio", { name: "Seller" }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto("/en/studio");
  await expect(page.getByRole("heading", { level: 1, name: "Expert Agent Studio" })).toBeVisible();
  await page.getByLabel("Agent name").fill(name);
  await page.getByRole("button", { name: "Create the studio" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Example data: replace with your panel")).toBeVisible();
  await expect(page.getByText("Provider type").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Example Lender A" })).toBeVisible();
  await expect(page.getByText("closing = opening + inflow").first()).toBeVisible();
  await noOverflow(page);
  await expectAccessible(page);

  await page.getByRole("button", { name: "Run the test bench" }).click();
  await expect(page.getByText("Pass").first()).toBeVisible();
  await expect(page.getByText("Proof has not finished, so there is no win rate yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Example data: replace with your panel")).toBeVisible();
  const listingUrl = page.url();
  await signOut(page);

  await page.goto("/en/register?role=buyer");
  await page.getByLabel("Name").fill("Studio Buyer");
  await page.getByLabel("Email").fill(buyerEmail);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("radio", { name: "Buyer" }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.goto(listingUrl);
  await page.getByRole("button", { name: "Pay and open the intake" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();
  await page.getByLabel(/Provider type/).selectOption("SIL");
  await page.getByLabel(/NDIS registration/).selectOption("registered");
  await page.getByLabel(/Revenue mix/).selectOption("plan-managed");
  await page.getByLabel(/Trade debtors/).fill("180000");
  await page.getByLabel(/Credit sales/).fill("900000");
  await page.getByLabel(/SIL or SDA exposure/).selectOption("yes");
  await page.getByLabel(/ATO position/).selectOption("clear");
  await page.getByLabel(/^ATO debt/).fill("0");
  await page.getByLabel(/Purpose of funds/).selectOption("wages");
  await page.getByLabel(/Months trading/).fill("18");
  await page.getByLabel(/Annual revenue/).fill("900000");
  await page.getByLabel(/Credit position/).selectOption("clear");
  await page.getByLabel(/Amount sought/).fill("120000");
  await page.getByRole("button", { name: "Save answers" }).click();
  await expect(page.getByLabel(/SDA property value/)).toBeVisible();
  await page.getByLabel(/SDA property value/).fill("400000");
  await page.getByRole("button", { name: "Save answers" }).click();
  await page.getByLabel("Bank or Xero CSV").setInputFiles({
    name: "cashflow.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("week,inflow,outflow\n1,1000,400\n2,0,900\n"),
  });
  await page.getByRole("button", { name: "Prepare the report" }).click();
  await expect(page.getByRole("heading", { name: "Funding options report" })).toBeVisible();
  await expect(page.getByText("indicative, not a credit offer").first()).toBeVisible();
  await expect(page.getByText(/Example Lender A/).first()).toBeVisible();
  await expect(page.getByText(/min_trading_months/).first()).toBeVisible();
  await page.getByRole("button", { name: "Request the broker" }).click();
  await expect(page.getByText("The broker has the lead.")).toBeVisible();
  const share = page.getByRole("link", { name: "Share this intake with your client" });
  const href = await share.getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href ?? "/en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Questions for");
  await expect(page.getByText("Example Lender A")).toHaveCount(0);
  await noOverflow(page);
  await expectAccessible(page);
});
