import { expect, test, type Page } from "@playwright/test";

test.describe("phone personas", () => {
  test.beforeEach(({ }, info) => {
    test.skip(info.project.name !== "mobile", "persona walks use a phone");
  });
  test.use({ viewport: { width: 390, height: 844 } });

  test("Maya, a bakery owner, gets a customer reply", async ({ page }) => {
    // Example fixture standing in for the live model: a sendable reply, not an echo of the instructions.
    await hire(page, "maya", "Draft a calm support reply that restates the catering issue and the next step", "Support reply", "$15.00", "Thanks for writing about the catering order");
  });

  test("Derek, an ops manager, gets an onboarding checklist", async ({ page }) => {
    // Example fixture standing in for the live model: a full checklist.
    await hire(page, "derek", "Turn a recurring operations task into a checklist a teammate can follow", "Ops checklist", "$25.00", "Confirm who owns the task today");
  });

  test("Priya, a freelancer, gets a scope note", async ({ page }) => {
    // Example fixture standing in for the live model: scope, assumptions, and what is out.
    await hire(page, "priya", "Rewrite a vague request into scope, assumptions, and out-of-scope items for a client brief", "Scope note", "$30.00", "Out of scope");
  });

  test("Helen, a retired engineer, publishes a drawing check", async ({ page }) => {
    await publish(page, "helen", "Checking engineering drawings for missing dimensions and clashes", "$45");
  });

  test("Andre, a bookkeeper, publishes a monthly close", async ({ page }) => {
    await publish(page, "andre", "Closing the books for small shops and flagging expenses that need a receipt", "$35");
  });

  test("Luis, a rideshare driver, publishes a soccer practice plan", async ({ page }) => {
    await publish(page, "luis", "Writing youth soccer practice plans that parents can use at the park", "$20");
  });
});

function screen(page: Page, heading: string) {
  return page.locator("main").filter({ has: page.getByRole("heading", { level: 1, name: heading }) });
}

async function expectClear(page: Page, heading: string) {
  const text = await screen(page, heading).innerText();
  expect(text).not.toMatch(/\bsearch agent\b|\bfixture\b|\bsnapshot\b/i);
  await expect(screen(page, heading).getByRole("heading", { level: 1 })).not.toHaveText(/^Run$/);
}

async function hire(page: Page, file: string, need: string, title: string, price: string, deliverable: string) {
  const steps: string[] = [];
  const home = "Build the AI twin of your expertise. Prove it beats plain AI. Deploy it everywhere.";
  await page.goto("/en");
  await expect(screen(page, home).getByRole("heading", { level: 1 })).toHaveText(home);
  await expect(screen(page, home).getByText("On a large or complex deal the twin stops and hands the work to you.")).toBeVisible();
  await expectClear(page, home);
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-home.png`, fullPage: false });
  await screen(page, home).getByRole("link", { name: "Get something done", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What do you need done?" })).toBeVisible();
  await expect(screen(page, "What do you need done?").getByText("from $15, in minutes.")).toBeVisible();
  await page.getByLabel("What do you need done?").fill(need);
  await page.getByRole("button", { name: "Show my matches" }).click();
  steps.push("type the need");
  await expect(page.getByRole("heading", { level: 1, name: "Your top matches" })).toBeVisible();
  await expect(screen(page, "Your top matches").getByRole("article")).toHaveCount(3);
  const match = screen(page, "Your top matches").getByRole("article").filter({ has: page.getByRole("heading", { level: 2, name: title }) });
  await expect(match.getByText(price, { exact: true })).toBeVisible();
  await expect(match.getByText("Draft in minutes")).toBeVisible();
  await expect(match.getByRole("heading", { name: "Sample output" })).toBeVisible();
  await expect(match.getByText(/example rating|No reviews yet/)).toBeVisible();
  await expectClear(page, "Your top matches");
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-matches.png`, fullPage: true });
  steps.push("see the top matches");
  await match.getByRole("button", { name: `Pay ${price} and get this` }).click();
  steps.push("pay and get the result");
  await expect(page.getByRole("heading", { level: 1, name: "Your draft" })).toBeVisible();
  await expect(screen(page, "Your draft").getByText("Paid. Here is your draft.")).toBeVisible();
  await expect(screen(page, "Your draft").getByText(deliverable)).toBeVisible();
  await expect(screen(page, "Your draft").getByText("Instructions used")).toHaveCount(0);
  await expectClear(page, "Your draft");
  expect(steps).toHaveLength(3);
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-result.png`, fullPage: true });
}

async function publish(page: Page, file: string, skill: string, price: string) {
  const steps: string[] = [];
  const email = `${file}-${Date.now()}@example.test`;
  const home = "Build the AI twin of your expertise. Prove it beats plain AI. Deploy it everywhere.";
  await page.goto("/en");
  await expect(screen(page, home).getByRole("heading", { level: 1 })).toHaveText(home);
  await expect(screen(page, home).getByText("On a large or complex deal the twin stops and hands the work to you.")).toBeVisible();
  await expectClear(page, home);
  await screen(page, home).getByRole("link", { name: "Earn from your skills", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What are you great at?" })).toBeVisible();
  await expect(screen(page, "What are you great at?").getByText("Turn what you know into an agent that earns while you sleep.")).toBeVisible();
  await expect(screen(page, "What are you great at?").getByText("You keep 80%")).toBeVisible();
  await expectClear(page, "What are you great at?");
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-earn.png`, fullPage: false });
  await page.getByLabel("What are you great at?").fill(skill);
  await page.getByRole("button", { name: "Draft my listing" }).click();
  steps.push("what are you great at");
  const draft = screen(page, "What are you great at?");
  await expect(draft.getByRole("heading", { name: "What a buyer would see" })).toBeVisible();
  await expect(draft.getByText(price, { exact: false }).first()).toBeVisible();
  await expect(draft.getByText("Preview. Not a published listing yet.")).toBeVisible();
  await expect(draft.getByLabel("Title")).toHaveValue(skill);
  await expect(draft.getByText("You keep 80%")).toBeVisible();
  await expect(screen(page, "What are you great at?").getByText(`You keep ${price === "$45" ? "$36" : price === "$35" ? "$28" : "$16"}`)).toBeVisible();
  await expectClear(page, "What are you great at?");
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-draft.png`, fullPage: true });
  steps.push("see the drafted listing");
  await draft.getByLabel("Name", { exact: true }).fill(file);
  await draft.getByLabel("Email").fill(email);
  await draft.getByLabel("Password").fill("correct-horse");
  await draft.getByRole("button", { name: "Publish" }).click();
  steps.push("publish");
  await expect(page.getByRole("heading", { level: 1, name: skill })).toBeVisible();
  await expect(screen(page, skill).getByText("You are live.")).toBeVisible();
  await expect(screen(page, skill).getByText("You keep 80%")).toBeVisible();
  await expectClear(page, skill);
  expect(steps).toHaveLength(3);
  await page.screenshot({ path: `/opt/cursor/artifacts/persona-${file}-live.png`, fullPage: false });
}
