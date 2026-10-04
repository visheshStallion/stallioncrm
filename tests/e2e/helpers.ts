import { expect, type Page } from "@playwright/test";
import { SEED_PASSWORD, email } from "../../prisma/seed-data";

export async function login(page: Page, key: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email(key));
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}
