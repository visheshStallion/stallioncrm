import { expect, type Page } from "@playwright/test";
import { SEED_PASSWORD, email } from "../../prisma/seed-data";

export async function login(page: Page, key: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email(key));
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeAttached(); // the name is hidden on phone widths
}

export async function signOut(page: Page) {
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to continue")).toBeVisible();
}
