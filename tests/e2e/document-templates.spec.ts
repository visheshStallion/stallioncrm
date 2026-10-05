import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login, signOut } from "./helpers";

/**
 * Document template builder (prompt 21) through the screens: gallery → builder → approval → used at print time on
 * the record's letterhead – and invisible to another brand.
 */
const stamp = Date.now();
const NAME = `Offer letter ${stamp}`;
let templateUrl = "";

test.describe.configure({ mode: "serial" });

test("a brand manager designs a shared template from the gallery and submits it for approval", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/templates/documents");
  await page.getByTestId("new-doc-template").click();
  await expect(page.getByTestId("doc-starter-gallery").getByRole("link")).toHaveCount(10);
  await page.getByRole("link", { name: /Deal Summary \/ Offer Letter/ }).click();
  await page.getByLabel("Name").fill(NAME);
  await page.getByRole("radio", { name: /Everyone in the brand/ }).check();
  await page.getByLabel("Company (brand)").selectOption({ label: "HMNL – Hyundai" });
  await page.getByRole("button", { name: "Create and open the editor" }).click();
  await expect(page).toHaveURL(/\/templates\/documents\/[a-z0-9]+$/);
  templateUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("doc-status")).toContainText("Draft");

  // the page canvas: letterhead in the repeating header, the starter's blocks, and a block added from the side panel
  const builder = page.getByTestId("doc-builder");
  await expect(builder.getByRole("checkbox", { name: "Company letterhead" })).toBeChecked();
  const blocks = page.getByTestId("doc-body").locator("> section");
  const before = await blocks.count();
  await page.getByTestId("doc-palette").getByRole("button", { name: "Signature & stamp" }).click();
  await expect(blocks).toHaveCount(before + 1);
  await page.getByRole("button", { name: `Move block ${before + 1} up` }).click();
  await expect(blocks.nth(before - 1)).toHaveAttribute("data-block", "signatures");
  await page.getByTestId("doc-fields-panel").getByLabel("Search merge fields").fill("legalEntity");
  await expect(page.getByTestId("doc-fields-panel").getByRole("button", { name: "{{brand.legalEntity}}" })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);

  await page.getByTestId("doc-save").click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  // preview: rendered on the server for a deal the manager can open, on the HMNL letterhead
  await page.getByTestId("doc-preview-tab").click();
  const frame = page.getByTestId("doc-preview").locator("iframe");
  await expect(frame).toHaveAttribute("srcdoc", /data-letterhead="HMNL"/);
  await expect(frame).toHaveAttribute("srcdoc", /Company stamp/);
  const pdf = page.waitForEvent("download");
  await page.getByTestId("doc-test-pdf").click();
  expect((await pdf).suggestedFilename()).toMatch(/-test\.pdf$/);

  // a brand manager cannot publish a shared template: it goes to the Brand Admin
  await expect(page.getByTestId("doc-actions").getByRole("button", { name: /^Publish/ })).toHaveCount(0);
  await page.getByTestId("doc-actions").getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByTestId("doc-status")).toContainText("Pending approval");
  await expect(page.getByTestId("doc-save")).toHaveCount(0);
});

test("the Brand Admin approves it; it becomes the brand's default and prints a deal on the HMNL letterhead", async ({ page }) => {
  await login(page, "ba.hmnl");
  await page.goto("/approvals");
  const task = page.getByTestId("approval-task").filter({ hasText: NAME });
  await expect(task).toContainText("Document template");
  await task.getByLabel("Decision comment").fill("Approved");
  await task.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("approval-task").filter({ hasText: NAME })).toHaveCount(0);
  await page.goto(templateUrl);
  await expect(page.getByTestId("doc-status")).toContainText("Published · version 1");
  await page.getByTestId("doc-actions").getByRole("button", { name: /Make default/ }).click();
  await expect(page.getByText("This is now the default template").first()).toBeVisible();
  await signOut(page);

  await login(page, "exec.hmnl.1");
  await page.goto("/deals?view=all");
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  await expect(page.getByTestId("record-header")).toBeVisible();
  const dealId = page.url().split("/").pop()!.split("?")[0]!;
  const preview = await page.request.get(`/print/deals/${dealId}`);
  expect(preview.status()).toBe(200);
  const html = await preview.text();
  expect(html).toContain('data-letterhead="HMNL"');
  expect(html).toContain("Offer:"); // the default template was used without choosing it
  expect(html).toMatch(new RegExp(`<option value="doc:[a-z0-9]+" selected>${NAME} \\(HMNL\\)`)); // and it is in the template dropdown
  const pdf = await page.request.get(`/print/deals/${dealId}?format=pdf`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  // the exec sees the published template in the list, read-only
  await page.goto("/templates/documents?module=deals");
  await expect(page.getByTestId("doc-templates-table")).toContainText(NAME);
  await page.goto(templateUrl);
  await expect(page.getByTestId("doc-save")).toHaveCount(0);
  await expect(page.getByTestId("doc-actions").getByRole("button")).toHaveCount(0);
  // official documents: a sales exec cannot create an invoice template
  await page.goto("/templates/documents/new?starter=tax-invoice");
  await expect(page.getByTestId("doc-financial-note")).toBeVisible();
});

test("another brand does not see the template – not in the list, not by address, not at print time", async ({ page }) => {
  await login(page, "bm.snmnl");
  await page.goto("/templates/documents");
  await expect(page.getByTestId("doc-templates-table")).not.toContainText(NAME);
  expect((await page.goto(templateUrl))?.status()).toBe(404);
  const id = templateUrl.split("/").pop()!;
  await page.goto("/deals?view=all");
  await page.getByTestId("data-row").first().getByRole("link").first().click();
  await expect(page.getByTestId("record-header")).toBeVisible();
  const dealId = page.url().split("/").pop()!.split("?")[0]!;
  expect((await page.request.get(`/print/deals/${dealId}?template=doc:${id}`)).status()).toBe(404);
  const own = await page.request.get(`/print/deals/${dealId}`);
  expect(await own.text()).toContain('data-letterhead="SNMNL"');
});
