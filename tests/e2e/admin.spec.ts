import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const ADMIN_PAGES = [
  "/admin",
  "/admin/brands",
  "/admin/regions",
  "/admin/territories",
  "/admin/roles",
  "/admin/profiles",
  "/admin/users",
  "/admin/users/import",
  "/admin/audit",
];
const ADMIN_APIS = ["/api/v1/admin/brands", "/api/v1/admin/users", "/api/v1/admin/audit", "/api/v1/admin/audit/export"];

for (const key of ["md", "exec.hmnl.1"]) {
  test(`non-admin (${key}) gets 404 on every /admin route and API`, async ({ page }) => {
    await login(page, key);
    await expect(page.getByTestId("setup-gear")).toHaveCount(0);
    for (const path of ADMIN_PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    for (const path of ADMIN_APIS) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(404);
    }
  });
}

test("administrator can open admin screens", async ({ page }) => {
  await login(page, "admin");
  await page.getByTestId("setup-gear").click();
  await expect(page.getByTestId("setup-landing")).toBeVisible();
  await page.goto("/admin/brands");
  await expect(page.getByTestId("brand-row")).toHaveCount(10);
  await page.goto("/admin/territories");
  await expect(page.getByTestId("territory-node")).toHaveCount(51);
  await page.goto("/admin/profiles");
  await page.getByTestId("profile-row").filter({ hasText: "Sales Exec" }).click();
  await expect(page.getByTestId("permission-grid")).toBeVisible();
  const res = await page.request.get("/api/v1/admin/brands");
  expect(res.status()).toBe(200);
});

test("CSV import shows a dry-run preview before anything is written", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/users/import");
  await page.getByLabel("CSV text").fill(
    [
      "name,email,company_codes,role,region",
      'E2E Rep,e2e.rep@stallioncrm.test,"HMNL, SNML, SNMN",Sales Exec,Lagos',
      "E2E NoCo,e2e.noco@stallioncrm.test,-,Sales Exec,Lagos",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Dry run" }).click();
  const preview = page.getByTestId("import-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("1 ready");
  await expect(page.getByTestId("import-summary")).toContainText("1 need confirmation");
  await expect(page.getByTestId("import-row").first()).toContainText("HMNL – Lagos, SNMNL – Lagos");
  await page.getByRole("button", { name: "Import 1 user(s)" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await page.goto("/admin/users?q=e2e");
  await expect(page.getByTestId("user-row")).toHaveCount(1);
});
