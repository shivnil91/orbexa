import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function expectAccessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
}

test("buyer journey keeps missing evidence and clears the vitals budget", async ({ page }, info) => {
  await page.addInitScript(() => {
    const target = window as Window & { __cls?: number; __lcp?: number };
    target.__cls = 0;
    target.__lcp = 0;
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1) as { startTime?: number } | undefined;
      if (last?.startTime) {
        target.__lcp = last.startTime;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) {
          target.__cls = (target.__cls ?? 0) + (shift.value ?? 0);
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/en/listings/hospital-beds");
  await page.waitForFunction(() => (window as Window & { __lcp?: number }).__lcp! > 0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hospital bed response");
  await expectAccessible(page);
  const vitals = await page.evaluate(() => {
    const target = window as Window & { __cls?: number; __lcp?: number };
    return { lcp: target.__lcp ?? 0, cls: target.__cls ?? 0 };
  });
  expect(vitals.lcp).toBeGreaterThan(0);
  expect(vitals.lcp).toBeLessThan(2500);
  expect(vitals.cls).toBeLessThan(0.1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/listing.png", fullPage: true });
  }

  await page.getByRole("link", { name: /Expert Verified/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Name this job");
  await expectAccessible(page);
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/intake.png", fullPage: true });
  }
  await page.getByLabel("Opportunity name").fill("Fictional ward beds");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pay");
  await expect(page.getByText("Demo payment. No card is charged.")).toBeVisible();
  await expect(page.getByText("Review fee")).toBeVisible();
  await expectAccessible(page);
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/checkout.png", fullPage: true });
  }
  await page.getByRole("button", { name: "Pay and get the draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your draft");
  for (let step = 0; step < 6; step += 1) {
    const next = page.getByRole("button", { name: "Show the next part" });
    if (!(await next.count())) {
      break;
    }
    await next.click();
  }
  await expect(page.getByText("Missing evidence").first()).toBeVisible();
  await expect(page.getByText("950 mm").first()).toBeVisible();
  await expectAccessible(page);
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/run.png", fullPage: true });
  }
  await page.getByRole("link", { name: "Read the draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review");
  await expect(page.getByRole("checkbox", { name: /future training set/ })).not.toBeChecked();
  await page.getByRole("button", { name: "An expert has looked at this" }).click();
  await page.getByRole("button", { name: "Accept this draft" }).click();
  await expect(page.getByText("You accepted this draft")).toBeVisible();
  await expectAccessible(page);
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/review.png", fullPage: true });
  }
  await page.goto("/en/dashboard");
  await expect(page.getByText("No invocations have been recorded yet").or(page.getByText("Grounded-claim rate"))).toBeVisible();
  if (info.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/dashboard.png", fullPage: true });
  }
});
