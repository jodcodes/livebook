import { expect, test } from "@playwright/test";

test("legal user can move through review, proofread, ask, draft, projects, and settings", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Legal Counsel/i }).click();

  await page.locator("button").filter({ hasText: /^Review$/ }).first().click();
  await page.locator("button").filter({ hasText: /Custom Review/ }).first().click();
  await expect(page.getByText("Custom review instructions")).toBeVisible();
  await page.locator("button").filter({ hasText: /Review document/ }).first().click();
  await expect(page.getByText("Redline summary")).toBeVisible();
  await page.locator("button").filter({ hasText: /Edit before apply/ }).first().click();
  await expect(page.getByText("Edit redline before applying")).toBeVisible();

  await page.locator("button").filter({ hasText: /Final cleanup checks/ }).first().click();
  await page.locator("button").filter({ hasText: /^Proofread$/ }).first().click();
  await expect(page.locator("button").filter({ hasText: /Apply fix/ }).first()).toBeVisible();

  await page.locator("button").filter({ hasText: /^Ask$/ }).first().click();
  await page.locator("button").filter({ hasText: /Document Context/ }).first().click();
  await expect(page.getByText("Selected text", { exact: true })).toBeVisible();

  await page.locator("button").filter({ hasText: /^Draft$/ }).first().click();
  await expect(page.getByText("Precedent import")).toBeVisible();

  await page.locator("button").filter({ hasText: /^Projects$/ }).first().click();
  await expect(page.getByText("Project goal")).toBeVisible();

  await page.locator("button").filter({ hasText: /^Settings$/ }).first().click();
  await expect(page.getByText("Role permissions")).toBeVisible();

  await expect(page.locator("body")).not.toContainText("Market");
  expect(consoleErrors).toEqual([]);
});
