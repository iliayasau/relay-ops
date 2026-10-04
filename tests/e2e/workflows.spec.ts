import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("declare, assign, resolve, reload and verify status page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Declare incident" }).click();
  const dialog = page.getByRole("dialog");
  const title = `Storage disruption ${Date.now()}`;
  await dialog.getByLabel("Incident title").fill(title);
  await dialog.getByLabel("Affected service").selectOption("storage");
  await dialog.getByLabel("Severity", { exact: true }).selectOption("SEV1");
  await dialog
    .getByLabel("Initial update")
    .fill("Uploads are timing out in the demo region.");
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button").filter({ hasText: title }).click();
  await dialog.getByLabel("Status", { exact: true }).selectOption("Resolved");
  await dialog.getByLabel("Incident lead").selectOption("Theo Martin");
  await dialog
    .getByLabel("Response update")
    .fill("Recovery confirmed after the storage configuration rollback.");
  await dialog.getByRole("button", { name: "Save update" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resolved", exact: true }).click();
  await page.getByLabel("Search incidents").fill(title);
  await page.getByRole("button").filter({ hasText: title }).click();
  await expect(dialog.getByText(/Assigned to Theo Martin/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
test("responsive workspace, empty/error/loading states and accessibility", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Service health" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel("Search incidents").fill("no-matching-incidents");
  await expect(page.getByText("Nothing to investigate here.")).toBeVisible();
  await page.getByLabel("Preview state").selectOption("Error");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel("Preview state").selectOption("Loading");
  await expect(page.getByText("Loading workspace…")).toBeVisible();
  await page.getByLabel("Preview state").selectOption("Live");
  for (const [width, height] of [
    [1440, 1100],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByLabel("Search incidents").fill("");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `docs/screenshots/workspace-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/status");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/status-mobile.png",
    fullPage: true,
  });
});
