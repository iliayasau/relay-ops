import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const mode of ["create", "update"] as const) {
  test(`late ${mode} response cannot dismiss a newer draft`, async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    if (mode === "create") {
      await page.getByRole("button", { name: "Declare incident" }).click();
      await dialog.getByLabel("Incident title").fill("Delayed save regression");
      await dialog
        .getByLabel("Initial update")
        .fill("Testing a slow response without losing another draft.");
    } else {
      await page
        .getByRole("button")
        .filter({ hasText: "Elevated latency on core endpoints" })
        .click();
      await dialog
        .getByLabel("Response update")
        .fill("A delayed response should not close a later dialog.");
    }
    let release!: () => void;
    let markSaved!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const serverSaved = new Promise<void>((resolve) => {
      markSaved = resolve;
    });
    await page.route(
      mode === "create" ? "**/api/incidents" : "**/api/incidents/*",
      async (route) => {
        const response = await route.fetch();
        markSaved();
        await responseGate;
        await route.fulfill({ response });
      },
    );
    await dialog
      .getByRole("button", {
        name: mode === "create" ? "Create incident" : "Save update",
      })
      .click();
    await serverSaved;
    if (mode === "create") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Declare incident" }).click();
    await dialog
      .getByLabel("Incident title")
      .fill("New unsaved draft must survive");
    await dialog
      .getByLabel("Initial update")
      .fill("Keep this text when the previous request finishes.");
    release();
    await expect(page.locator(".notice")).toContainText("saved successfully");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Incident title")).toHaveValue(
      "New unsaved draft must survive",
    );
    await expect(dialog.getByLabel("Initial update")).toHaveValue(
      "Keep this text when the previous request finishes.",
    );
    await expect(
      dialog.getByRole("button", { name: "Create incident" }),
    ).toBeEnabled();
  });
}
test("failed save preserves the form and keyboard dismissal restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Declare incident" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Incident title").fill("Notification delivery issue");
  await dialog
    .getByLabel("Initial update")
    .fill("Messages are delayed while the queue is investigated.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.route("**/api/incidents", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporarily unavailable. Please retry." }),
    }),
  );
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Temporarily unavailable",
  );
  await expect(dialog.getByLabel("Incident title")).toHaveValue(
    "Notification delivery issue",
  );
  await page.unroute("**/api/incidents");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Declare incident" }),
  ).toBeFocused();
});
test("declare, assign, resolve, reload and verify status page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Declare incident" }).click();
  const dialog = page.getByRole("dialog");
  const title = "Storage upload disruption";
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
  const statusRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      statusRequests.push(new URL(request.url()).pathname);
  });
  await page.goto("/status");
  const publicIncident = page.locator(".public-incident").filter({
    has: page.getByRole("heading", { name: "Object storage incident" }),
  });
  await expect(publicIncident).toContainText("Resolved");
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByText("Theo Martin")).toHaveCount(0);
  expect(statusRequests).toEqual(["/api/public/status"]);
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
