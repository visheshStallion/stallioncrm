import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Create Quote page: the screenshot's fields, required phone and e-mail, stage Draft, locked rate; edit and clone. */
test("create a quote with organisation, subject, TIN, phone and e-mail; edit it; clone it", async ({ page }) => {
  const stamp = Date.now();
  await login(page, "exec.hmnl.1");
  await page.goto("/quotes/new");
  const form = page.getByTestId("quote-form");
  await expect(page.getByRole("heading", { name: "Create Quote" })).toBeVisible();
  await expect(page.locator("#q-stage option:checked")).toHaveText("Draft");
  await expect(page.locator("#q-rate")).toHaveValue("1");
  await expect(page.locator("#q-rate")).toHaveAttribute("readonly", "");
  await expect(page.locator("#q-owner")).not.toHaveValue("");
  for (const id of ["#q-phone", "#q-email"]) await expect(page.locator(id)).toHaveClass(/crm-po-req/);

  await page.getByTestId("q-save").click();
  await expect(form.getByText("Enter the phone number")).toBeVisible();
  await expect(form.getByText("Enter a valid e-mail address")).toBeVisible();

  await page.locator("#q-org-name").fill(`Adeyemi Logistics ${stamp}`);
  await page.locator("#q-org-address").fill("12 Allen Avenue");
  await page.locator("#q-org-city").fill("Ikeja");
  await page.locator("#q-subject").fill(`Fleet quote ${stamp}`);
  await page.locator("#q-tin").fill("12345678-0001");
  await page.locator("#q-phone").fill("+2348030000000");
  await page.locator("#q-email").fill(`fleet${stamp}@example.test`);
  await page.locator("#inv-account").fill(`Tunde Adeyemi ${stamp}`);
  await page.locator("#billing-street").fill("12 Allen Avenue");
  await form.getByLabel("Row 1, Product Name").fill("Fleet service");
  await form.getByLabel("Row 1, Quantity").fill("3");
  await form.getByLabel("Row 1, List Price").fill("20000");
  await page.getByTestId("q-save").click();
  await expect(page).toHaveURL(/\/quotes\/(?!new)[a-z0-9]+$/);
  await expect(page.locator('[data-field="Subject"]')).toHaveText(`Fleet quote ${stamp}`);
  await expect(page.locator('[data-field="Email Id"]')).toHaveText(`fleet${stamp}@example.test`);
  await expect(page.locator('[data-field="TIN Number"]')).toHaveText("12345678-0001");

  await page.getByTestId("q-edit").click();
  await expect(page.getByRole("heading", { name: /Edit Quote/ })).toBeVisible();
  await page.locator("#q-subject").fill(`Fleet quote ${stamp} – revised`);
  await page.getByTestId("q-save").click();
  await expect(page.locator('[data-field="Subject"]')).toHaveText(`Fleet quote ${stamp} – revised`);

  await page.getByTestId("q-clone").click();
  await expect(page.getByRole("heading", { name: "Clone Quote" })).toBeVisible();
  await expect(page.locator("#q-subject")).toHaveValue(`Fleet quote ${stamp} – revised (copy)`);
  await expect(page.getByTestId("grid-row")).toHaveCount(1);
});
