import { expect, test, type Page } from "@playwright/test";
import { login, signOut } from "./helpers";

/**
 * Print and e-mail (prompt 20) through the screens: print preview on the record's letterhead, the composer sending as
 * the record's brand, the template gallery and editor – and other brands getting a 404 on all of it.
 */
const stamp = Date.now();
let leadId = "";

async function sender(page: Page, code: string, fromEmail: string) {
  await page.goto("/admin/brands");
  await page.getByRole("link", { name: code, exact: true }).first().click();
  await expect(async () => {
    await page.waitForLoadState("networkidle");
    const box = page.getByTestId("sender-identity");
    await box.getByLabel("Email from-name").fill(`${code} Sales`);
    await box.getByLabel("Email from-address").fill(fromEmail);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Brand saved").first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("sender-identity").getByLabel("Email from-address")).toHaveValue(fromEmail, { timeout: 3000 });
  }).toPass({ timeout: 45_000 });
}

test.describe.configure({ mode: "serial" });

test("Print on a record opens the preview on the record's brand letterhead; PDF download works", async ({ page }) => {
  await login(page, "admin");
  await sender(page, "HMNL", "sales@hmnl.example.test");
  await signOut(page);

  await login(page, "exec.multi.1"); // HMNL + SNMNL
  const me = (await (await page.request.get("/api/v1/me")).json()) as { data: { memberships: Array<{ brandId: string; regionId: string }> } };
  const hmnl = (await page.getByTestId("brand-switcher").locator("option", { hasText: /^HMNL/ }).getAttribute("value"))!;
  const res = await page.request.post("/api/v1/leads", { data: { firstName: "Tunde", lastName: `Print ${stamp}`, mobile: `+23470${String(stamp).slice(-8)}`, email: `tunde.${stamp}@example.test`, source: "WALK_IN", brandId: hmnl, regionId: me.data.memberships[0]!.regionId } });
  expect(res.status()).toBe(201);
  leadId = ((await res.json()) as { data: { id: string } }).data.id;

  await page.goto(`/leads/${leadId}`);
  await expect(page.getByTestId("print-record")).toBeVisible();
  const preview = await page.request.get(`/print/leads/${leadId}`);
  expect(preview.status()).toBe(200);
  const html = await preview.text();
  expect(html).toContain('data-letterhead="HMNL"');
  expect(html).toContain(`Print ${stamp}`);
  expect(html).not.toContain('data-letterhead="SNMNL"');
  // asking for another company's letterhead on a brand-owned record changes nothing
  expect(await (await page.request.get(`/print/leads/${leadId}?company=group`)).text()).toContain('data-letterhead="HMNL"');
  const pdf = await page.request.get(`/print/leads/${leadId}?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("Send Email on a record: brand sender, preview in the brand layout, sent and logged on the record", async ({ page }) => {
  await login(page, "exec.multi.1");
  await page.goto(`/leads/${leadId}`);
  await page.getByTestId("send-email").click();
  await expect(page).toHaveURL(/\/email\/compose\?type=Lead/);
  await expect(page.getByTestId("email-from")).toHaveText("HMNL Sales <sales@hmnl.example.test>");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(`tunde.${stamp}@example.test`);
  await page.getByLabel("Subject").fill("Your {{brand.code}} enquiry");
  const editor = page.getByRole("textbox", { name: "E-mail text" });
  await editor.click();
  await page.keyboard.type("Dear {{contact.firstName}}, thank you for visiting us.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const frame = page.getByTestId("email-preview").locator("iframe");
  await expect(frame).toHaveAttribute("srcdoc", /data-brand="HMNL"/);
  await expect(frame).toHaveAttribute("srcdoc", /Dear Tunde, thank you for visiting us\./);
  await expect(page.getByTestId("email-preview")).toContainText("Subject: Your HMNL enquiry");
  await page.getByRole("button", { name: "Mobile" }).click();
  await expect(frame).toHaveCSS("width", "360px");

  await page.getByTestId("email-send").click();
  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}$`));
  const sent = (await (await page.request.get(`/api/v1/messages?parentType=Lead&parentId=${leadId}`)).json()) as { data: Array<{ fromAddress: string; subject: string; status: string; body: string }> };
  expect(sent.data[0]).toMatchObject({ fromAddress: "sales@hmnl.example.test", status: "SENT", subject: "Your HMNL enquiry" });
  expect(sent.data[0]!.body).toContain("Dear Tunde, thank you for visiting us.");
});

test("another brand's exec gets a 404 on the print, the PDF and the composer of the record", async ({ page }) => {
  await login(page, "exec.snmnl.1");
  expect((await page.request.get(`/print/leads/${leadId}`)).status()).toBe(404);
  expect((await page.request.get(`/print/leads/${leadId}?format=pdf`)).status()).toBe(404);
  expect((await page.goto(`/email/compose?type=Lead&id=${leadId}`))?.status()).toBe(404);
  expect((await page.goto(`/email/compose?type=Nothing&id=${leadId}`))?.status()).toBe(404);
});

test("a brand manager creates an e-mail template from the starter gallery; versions and brand scope", async ({ page }) => {
  await login(page, "bm.hmnl");
  await page.goto("/campaigns/templates");
  await page.getByTestId("new-email-template").click();
  await expect(page.getByTestId("starter-gallery").getByRole("link")).toHaveCount(11);
  await page.getByRole("link", { name: /Quotation sent/ }).click();
  const box = page.getByTestId("email-template-editor");
  await expect(box.getByLabel("Subject")).toHaveValue("Your quotation {{quote.number}} from {{brand.name}}");
  await box.getByLabel("Name").fill(`Quotation ${stamp}`);
  await box.getByRole("button", { name: "Preview and check" }).click();
  await expect(page.getByTestId("email-preview").locator("iframe")).toHaveAttribute("srcdoc", /Q-2026-00045/);
  await page.getByTestId("template-save").click();
  await expect(page).toHaveURL(/\/campaigns\/templates\/email\/[a-z0-9]+$/);
  await expect(page.getByTestId("template-versions")).toContainText("Version 1");
  const url = page.url();

  // a second save makes version 2, which can be compared with version 1
  await page.getByTestId("email-template-editor").getByLabel("Subject").fill("Quotation {{quote.number}}");
  await page.getByTestId("template-save").click();
  await expect(page.getByTestId("template-versions")).toContainText("Version 2");
  await page.getByTestId("template-versions").getByRole("link", { name: "Compare" }).click();
  await expect(page.getByTestId("template-diff")).toContainText("− Subject: Your quotation");
  await expect(page.getByTestId("template-diff")).toContainText("+ Subject: Quotation");
  await signOut(page);

  // the template belongs to HMNL: an SNMNL manager does not find it
  await login(page, "bm.snmnl");
  expect((await page.goto(url))?.status()).toBe(404);
  await page.goto("/campaigns/templates");
  await expect(page.getByTestId("templates-table")).not.toContainText(`Quotation ${stamp}`);
});

test("signature per brand in the personal settings", async ({ page }) => {
  await login(page, "exec.hmnl.1");
  await page.goto("/setup/personal");
  const box = page.getByTestId("personal-signatures");
  await box.getByRole("textbox", { name: "E-mail signature" }).click();
  await page.keyboard.type(`Regards ${stamp}`);
  await page.getByTestId("signature-save").click();
  await expect(page.getByText("Signature saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("personal-signatures").getByRole("textbox", { name: "E-mail signature" })).toContainText(`Regards ${stamp}`);
});
