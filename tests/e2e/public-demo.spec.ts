import { test, expect } from "@playwright/test";

test("hosted demo isolates browsers while preserving each visitor workflow", async ({
  page,
  browser,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await page.request.get("/healthz");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  await expect(
    page.getByText("Your own demo workspace.", { exact: false }),
  ).toBeVisible();
  const cookie = (await page.context().cookies()).find((cookie) =>
    cookie.name.endsWith("relay_demo"),
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(baseURL?.startsWith("https:"));
  expect(cookie?.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Declare incident" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Incident title")
    .fill("A private visitor demo draft");
  await dialog.getByLabel("Affected service").selectOption("storage");
  await dialog
    .getByLabel("Initial update")
    .fill("Only this browser should receive the operator details.");
  await dialog.getByRole("button", { name: "Create incident" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("button")
      .filter({ hasText: "A private visitor demo draft" }),
  ).toBeVisible();
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    otherPage.on("pageerror", (error) => errors.push(error.message));
    await otherPage.goto("/");
    await expect(
      otherPage.getByRole("heading", { name: "Service health" }),
    ).toBeVisible();
    await expect(
      otherPage.getByText("A private visitor demo draft"),
    ).toHaveCount(0);
    const publicResponse = await page.request.get("/api/public/status");
    expect(publicResponse.status()).toBe(200);
    const projection = await publicResponse.json();
    for (const service of projection.services)
      expect(Object.keys(service).sort()).toEqual(["health", "id", "name"]);
    for (const incident of projection.incidents)
      expect(Object.keys(incident).sort()).toEqual([
        "id",
        "serviceId",
        "status",
        "summary",
        "title",
        "updatedAt",
      ]);
    expect(errors).toEqual([]);
    await otherPage.goto("/status");
    await expect(
      otherPage.getByRole("heading", { name: "Incident updates" }),
    ).toBeVisible();
    await expect(
      otherPage.getByRole("heading", { name: "Object storage incident" }),
    ).toHaveCount(0);
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { name: "Object storage incident" }),
    ).toBeVisible();
    await expect(
      page.getByText("Only this browser should receive the operator details."),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});
