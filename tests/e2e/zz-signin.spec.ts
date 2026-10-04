import { expect, test, type Page } from "@playwright/test";
import { SEED_PASSWORD, email } from "../../prisma/seed-data";
import { totpCode } from "../../src/server/auth/protection";
import { login, signOut } from "./helpers";

async function attempt(page: Page, key: string, password: string, code?: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email(key));
  await page.getByLabel("Password").fill(password);
  if (code) await page.getByLabel(/Authenticator code/).fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("sign-in: lockout after five wrong passwords; an administrator unlocks the account", async ({ page }) => {
  const victim = "exec.zanl.2";
  for (let i = 1; i <= 4; i++) {
    await attempt(page, victim, `wrong-password-${i}`);
    await expect(page.locator("p[role=alert]")).toHaveText("Invalid email or password.");
  }
  await attempt(page, victim, "wrong-password-5");
  await expect(page.locator("p[role=alert]")).toContainText("locked for 15 minutes");
  // the right password does not help while the account is locked
  await attempt(page, victim, SEED_PASSWORD);
  await expect(page.locator("p[role=alert]")).toContainText("locked for 15 minutes");

  await login(page, "admin");
  await page.goto("/admin/access-review?flagged=0");
  await page.waitForLoadState("networkidle");
  const row = page.getByTestId("access-review").getByRole("row", { name: /Halima Musa/ });
  await expect(row).toContainText("locked");
  await expect(row).toContainText("ZANL");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Reset sign-in" }).click();
  await expect(row).not.toContainText("locked");
  const csv = await page.request.get("/api/v1/admin/access-review");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Halima Musa");
  await page.goto("/");
  await signOut(page);

  await login(page, victim);
  // the review is for administrators
  expect((await page.goto("/admin/access-review"))!.status()).toBe(404);
  expect((await page.request.get("/api/v1/admin/access-review")).status()).toBe(404);
});

test("two-step sign-in: set up with an authenticator, required at the next sign-in, switched off with a code", async ({ page }) => {
  const user = "exec.thpl.2";
  await login(page, user);
  await page.goto("/security");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  const secret = await page.getByTestId("new-secret").locator("input").first().inputValue();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.locator("#code").fill("000000");
  await page.getByRole("button", { name: "Confirm and switch on" }).click();
  await expect(page.getByText(/That code is not correct/)).toBeVisible();
  await page.waitForTimeout(700); // the form restores the rejected input just after the toast
  await page.locator("#code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Confirm and switch on" }).click();
  await expect(page.getByTestId("two-step")).toContainText("On");
  await page.goto("/");
  await signOut(page);

  // password alone is no longer enough
  await attempt(page, user, SEED_PASSWORD);
  await expect(page.locator("p[role=alert]")).toContainText("6-digit code");
  await attempt(page, user, SEED_PASSWORD, "000000");
  await expect(page.locator("p[role=alert]")).toHaveText("Invalid email or password.");
  await attempt(page, user, SEED_PASSWORD, totpCode(secret));
  await expect(page.getByTestId("current-user")).toBeAttached();

  // switch it off again (needs a code)
  await page.goto("/security");
  await page.waitForLoadState("networkidle");
  page.once("dialog", (d) => d.accept());
  await page.locator("#code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByTestId("two-step")).toContainText("Off");
});
