import { expect, test } from "@playwright/test";
import { login, signOut } from "./helpers";

const stamp = Date.now();

test("import wizard: a Brand Manager imports leads into the own brand only; undo removes them", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/imports");
  await page.waitForLoadState("networkidle");
  const csv = [
    "Last Name,First Name,Mobile,Company Code,Region",
    `Importone${stamp},Ada,0803${String(stamp).slice(-7)},HMNL,Lagos`,
    `Importtwo${stamp},Bayo,0805${String(stamp).slice(-7)},SNMNL,Lagos`,
    `,Nameless,0807${String(stamp).slice(-7)},HMNL,Lagos`,
  ].join("\n");
  await page.locator("#module").selectOption("leads");
  await page.locator("#file").setInputFiles({ name: `leads-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/\/imports\/c[a-z0-9]{20,}$/);

  // dry run: one row to create, the other brand's row and the nameless row are rejected
  const summary = page.getByTestId("dry-run-summary");
  await expect(summary).toContainText("Create");
  await expect(summary.locator("dd").first()).toHaveText("1");
  await expect(page.getByTestId("dry-run-rows")).toContainText("You cannot import into brand SNMNL");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "4. Start import" }).click();
  await expect(page.getByTestId("import-result")).toBeVisible();

  // the job runs on the scheduler tick
  await expect(async () => {
    await page.request.post("/api/public/cron/tick", { headers: { Authorization: "Bearer e2e-cron-secret" } });
    await page.reload();
    await expect(page.getByTestId("import-result")).toContainText("1 created", { timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  await page.goto(`/leads?view=all&q=Importone${stamp}`);
  await expect(page.getByText(`Importone${stamp}`).first()).toBeVisible();
  await page.goto(`/leads?view=all&q=Importtwo${stamp}`);
  await expect(page.getByText(`Importtwo${stamp}`)).toHaveCount(0);

  // undo
  await page.goto("/imports");
  await page.waitForLoadState("networkidle");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("import-history").getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByTestId("import-history")).toContainText("Undone");
  await page.goto(`/leads?view=all&q=Importone${stamp}`);
  await expect(page.getByText(`Importone${stamp}`)).toHaveCount(0);
});

test("exports honour permissions; executives cannot import or back up", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  expect((await page.goto("/imports"))!.status()).toBe(403);
  expect((await page.request.get("/api/v1/export/leads")).status()).toBe(403);
  expect((await page.request.post("/api/v1/admin/backup", { data: { passphrase: "a-long-enough-passphrase" } })).status()).toBe(404);
  expect((await page.goto("/admin/customization"))!.status()).toBe(404);
  await page.goto("/");
  await signOut(page);

  await login(page, "bm.hmnl");
  const csv = await page.request.get("/api/v1/export/deals?format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain("Deal name");
  expect(body).not.toMatch(/,SNMNL,|,SMGL,|,THPL,|,ZANL,/); // only the own brand
  const xlsx = await page.request.get("/api/v1/export/leads?format=xlsx");
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  expect((await page.request.post("/api/v1/admin/backup", { data: { passphrase: "a-long-enough-passphrase" } })).status()).toBe(404);
  await page.goto("/exports");
  await expect(page.getByTestId("export-modules")).toContainText("Deals");
  await expect(page.getByTestId("backup")).toHaveCount(0);
});

test("admin: custom field with a brand, shown on the lead form of that brand only; encrypted backup", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/customization?module=leads");
  await page.waitForLoadState("networkidle");
  const key = `e2e${String(stamp).slice(-8)}`;
  await page.locator("#label").fill(`E2E colour ${stamp}`);
  await page.locator("#apiName").fill(key);
  await page.locator("#type").selectOption("PICKLIST");
  await page.locator("#options").fill("Red, Blue");
  await page.locator("#brandId").selectOption({ label: "HMNL only" });
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByTestId("custom-fields")).toContainText(`cf_${key}`);

  await page.locator("#rules").fill(`REQUIRE cf_${key} WHEN source eq EVENT`);
  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText("Layout saved")).toBeVisible();

  const backup = await page.request.post("/api/v1/admin/backup", { data: { passphrase: "a-long-enough-passphrase" } });
  expect(backup.status()).toBe(200);
  expect(backup.headers()["content-disposition"]).toContain(".zip.enc");
  expect((await backup.body()).subarray(0, 2).toString()).not.toBe("PK"); // encrypted, not a plain zip
  expect((await page.request.post("/api/v1/admin/backup", { data: { passphrase: "short" } })).status()).toBe(400);
  await page.goto("/");
  await signOut(page);

  await login(page, "exec.hmnl.1");
  await page.goto("/leads/new");
  await expect(page.getByLabel(`E2E colour ${stamp}`)).toBeVisible();
  await page.goto("/");
  await signOut(page);
  await login(page, "exec.snmnl.1");
  await page.goto("/leads/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel(`E2E colour ${stamp}`)).toHaveCount(0);
});
