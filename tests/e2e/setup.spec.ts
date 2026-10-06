import { expect, test, type Page } from "@playwright/test";
import { SETUP_CATALOGUE, hrefOf, type SetupEntry } from "../../src/server/modules/setup/catalogue";
import { SEED_PASSWORD } from "../../prisma/seed-data";
import { login } from "./helpers";

/**
 * Setup (prompt 19): every Setup route and API × Super Admin / Administrator / Brand Admin / Brand Manager /
 * Sales Exec → page or 404; Brand Admin isolation; four eyes through the screens; search and "Coming soon".
 */
type Persona = { key: string; sa: boolean; admin: boolean; brandAdmin: boolean };
const PERSONAS: Persona[] = [
  { key: "superadmin", sa: true, admin: true, brandAdmin: false },
  { key: "crmadmin", sa: false, admin: true, brandAdmin: false },
  { key: "ba.hmnl", sa: false, admin: false, brandAdmin: true },
  { key: "bm.hmnl", sa: false, admin: false, brandAdmin: false },
  { key: "exec.snmnl.1", sa: false, admin: false, brandAdmin: false },
];

/** The rule of prompt 19 §1, written out independently of the application code. */
function allowed(p: Persona, e: SetupEntry): boolean {
  if (e.tiers.includes("ALL") || p.sa) return true;
  if (p.admin) return e.tiers.includes("ADMIN");
  if (p.brandAdmin) return e.tiers.includes("BRAND_ADMIN") && e.brandAdminReady === true;
  return false;
}

// pages reached through their own module permission (Import, Templates, …) are not decided by the Setup tier
const ROUTES = SETUP_CATALOGUE.filter((e) => !e.external);

for (const persona of PERSONAS) {
  test(`route matrix: ${persona.key} gets a page or 404 on every Setup function and API`, async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, persona.key);
    for (const e of ROUTES) {
      const res = await page.request.get(hrefOf(e));
      expect(res.status(), `${persona.key} → ${e.key} (${hrefOf(e)})`).toBe(allowed(persona, e) ? 200 : 404);
    }
    // a function that does not exist looks exactly like one the user may not open
    expect((await page.request.get("/setup/no-such-function")).status()).toBe(404);
    expect((await page.request.get("/setup")).status()).toBe(200); // everyone has at least the personal settings

    const api = async (resource: string) => (await page.request.get(`/api/v1/setup/${resource}`)).status();
    expect(await api("catalogue")).toBe(200);
    expect(await api("health"), "health").toBe(persona.admin ? 200 : 404);
    expect(await api("approvals"), "approvals").toBe(persona.sa ? 200 : 404);
    expect(await api("config"), "config").toBe(persona.sa ? 200 : 404);
    expect(await api("nothing")).toBe(404);
    if (!persona.sa) expect((await page.request.post("/api/v1/admin/backup", { form: { passphrase: "a-long-passphrase" } })).status(), "backup").toBe(404);

    const catalogue = (await (await page.request.get("/api/v1/setup/catalogue")).json()) as { data: { tier: string; categories: Array<{ items: Array<{ key: string }> }> } };
    const keys = catalogue.data.categories.flatMap((c) => c.items.map((i) => i.key)).sort();
    expect(keys).toEqual(SETUP_CATALOGUE.filter((e) => allowed(persona, e)).map((e) => e.key).sort());
    expect(catalogue.data.tier).toBe(persona.sa ? "SA" : persona.admin ? "ADMIN" : persona.brandAdmin ? "BRAND_ADMIN" : "USER");
  });
}

test("a sales exec has Setup for the personal settings only – no gear, one function", async ({ page }) => {
  await login(page, "exec.snmnl.2");
  await expect(page.getByTestId("setup-gear")).toHaveCount(0);
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("menuitem", { name: "Personal settings" }).click();
  await expect(page).toHaveURL(/\/setup\/personal/);
  await expect(page.getByTestId("setup-tier")).toHaveText("Everyone");
  await page.getByLabel("Date format").selectOption("YYYY-MM-DD");
  await expect(page.getByTestId("toast").filter({ hasText: "Saved" })).toBeVisible();
  await page.goto("/setup");
  await expect(page.getByTestId("setup-category")).toHaveCount(1);
  await expect(page.getByTestId("setup-category").getByRole("link")).toHaveText(["Personal Settings"]);
  await page.goto("/setup/personal");
  await page.getByLabel("Date format").selectOption("DD/MM/YYYY");
  await expect(page.getByTestId("toast").filter({ hasText: "Saved" })).toBeVisible();
});

/** Sign in as someone else in the same browser. */
async function switchUser(page: Page, key: string) {
  await page.context().clearCookies();
  await login(page, key);
}

async function brandIds(page: Page): Promise<Record<string, string>> {
  const res = await page.request.get("/api/v1/admin/brands");
  const body = (await res.json()) as { data: Array<{ id: string; code: string }> };
  return Object.fromEntries(body.data.map((b) => [b.code, b.id]));
}

test("Brand Admin of HMNL: own brand's team and thresholds only – SNMNL is not there, not even by address", async ({ page }) => {
  await login(page, "superadmin");
  const brands = await brandIds(page);

  await switchUser(page, "ba.hmnl");
  await page.getByTestId("setup-gear").click();
  await expect(page.getByTestId("setup-tier")).toContainText("Brand Admin");
  const links = await page.getByTestId("setup-category").getByRole("link").allTextContents();
  expect(links.sort()).toEqual(["Brand team (territory membership)", "Brand thresholds", "Dependencies", "Document templates", "Letterhead", "Personal Settings", "Print templates", "Purchase Orders", "Templates"]);

  await page.getByRole("link", { name: "Brand team (territory membership)" }).click();
  await expect(page.getByTestId("brand-team-brand")).toContainText("HMNL");
  await expect(page.getByRole("main").getByRole("combobox", { name: "Brand" })).toHaveCount(0); // one brand: nothing to choose
  const territories = await page.getByTestId("brand-territory").locator("h2").allTextContents();
  expect(territories.length).toBeGreaterThan(1);
  expect(territories.every((t) => t.startsWith("HMNL"))).toBe(true);
  await expect(page.locator("body")).not.toContainText("SNMNL");
  expect((await page.goto(`/setup/brand-members?brand=${brands.SNMNL}`))!.status()).toBe(404);

  await page.goto("/setup/brand-thresholds");
  await expect(page.getByTestId("threshold-row")).toHaveCount(1);
  const row = page.getByTestId("threshold-row");
  await expect(row).toHaveAttribute("data-brand", "HMNL");
  await row.getByLabel("Brand Manager above (%)").fill("3.5");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Thresholds of HMNL saved" })).toBeVisible();
  await row.getByLabel("Brand Manager above (%)").fill("3");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Thresholds of HMNL saved" }).last()).toBeVisible();

  // nothing else of Setup, and none of the administration of other people's data
  for (const path of ["/setup/validation-rules", "/setup/admin-tiers", "/setup/password-policy", "/setup/recycle-bin", "/admin/users", "/admin/pipelines", "/admin/workflows", "/admin/brands"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("four eyes: one Super Admin requests a session policy change, a second approves it with their password", async ({ page }) => {
  await login(page, "superadmin");
  await page.goto("/setup/sessions");
  await expect(page.getByTestId("setup-tier")).toHaveText("Super Admin");
  const hours = page.getByLabel("Sign in again after (hours)");
  const before = Number(await hours.inputValue());
  const target = before === 11 ? 10 : 11;
  await hours.fill(String(target));

  // without the password nothing is requested
  await page.getByRole("button", { name: "Request the change" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Wrong password" })).toBeVisible();
  await hours.fill(String(target));
  await page.getByLabel("Your password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Request the change" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Sent for approval" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sign in again after (hours)")).toHaveValue(String(before)); // not applied yet

  await page.goto("/setup");
  await expect(page.getByTestId("setup-pending")).toBeVisible();
  await page.getByRole("link", { name: "Two-person approvals" }).first().click();
  const mine = page.getByTestId("approval-request").filter({ hasText: `"maxHours":${target}` });
  await expect(mine).toContainText("You requested this: another Super Admin must decide.");
  await expect(mine.getByRole("button", { name: "Approve and carry out" })).toHaveCount(0);

  await switchUser(page, "admin");
  await page.goto("/setup/approvals");
  const request = page.getByTestId("approval-request").filter({ hasText: `"maxHours":${target}` });
  await expect(request).toContainText("requested by Super Admin");
  await request.getByLabel("Your password").fill(SEED_PASSWORD);
  await request.getByRole("button", { name: "Approve and carry out" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Approved and carried out" })).toBeVisible();
  await expect(page.getByTestId("approval-decided").filter({ hasText: `"maxHours":${target}` }).first()).toContainText("decided by Ifeoma Nwosu");

  await page.goto("/setup/sessions");
  await expect(page.getByLabel("Sign in again after (hours)")).toHaveValue(String(target));
  await page.goto("/setup/audit-trail?entity=SetupApproval");
  await expect(page.getByTestId("setup-audit-row").first()).toContainText("SetupApproval");
});

test("an administrator builds a validation rule: preview, save, the rule refuses a lead, delete", async ({ page }) => {
  await login(page, "crmadmin");
  await page.goto("/setup/validation-rules?module=leads");
  const form = page.getByTestId("validation-rule-form");
  await form.getByLabel("Rule name").fill("No placeholder surname");
  await form.getByLabel(/Refuse the save when this is true/).fill("lower(lastName) == nosuchfield");
  await form.getByLabel("Error message shown to the user").fill("Enter the customer's real surname");
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: 'Unknown field "nosuchfield"' })).toBeVisible();

  await form.getByLabel("Rule name").fill("No placeholder surname");
  await form.getByLabel(/Refuse the save when this is true/).fill('lower(lastName) == "zzplaceholder"');
  await form.getByLabel("Error message shown to the user").fill("Enter the customer's real surname");
  await form.getByRole("button", { name: "Preview impact" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Nothing was saved" })).toBeVisible();
  await expect(page.getByTestId("validation-rule")).toHaveCount(0);
  await form.getByLabel("Rule name").fill("No placeholder surname");
  await form.getByLabel(/Refuse the save when this is true/).fill('lower(lastName) == "zzplaceholder"');
  await form.getByLabel("Error message shown to the user").fill("Enter the customer's real surname");
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("validation-rule")).toContainText("No placeholder surname");

  // the rule holds wherever a lead is saved – here through the API
  const brands = await brandIds(page);
  const body = { lastName: "Zzplaceholder", mobile: "+2348035550000", brandId: brands.HMNL, regionId: "" };
  const regions = (await (await page.request.get("/api/v1/admin/regions")).json()) as { data: Array<{ id: string; name: string }> };
  body.regionId = regions.data.find((r) => r.name === "Lagos")!.id;
  const refused = await page.request.post("/api/v1/leads", { data: body, headers: { origin: new URL(page.url()).origin } });
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("Enter the customer's real surname");
  const accepted = await page.request.post("/api/v1/leads", { data: { ...body, lastName: "Okonjo" }, headers: { origin: new URL(page.url()).origin } });
  expect(accepted.status()).toBe(201);

  page.once("dialog", (d) => d.accept());
  await page.getByTestId("validation-rule").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("validation-rule")).toHaveCount(0);
});

test("a sharing rule that would cross brands is refused with the reason", async ({ page }) => {
  await login(page, "crmadmin");
  await page.goto("/setup/data-sharing?target=TERRITORY");
  const form = page.getByTestId("sharing-rule-form");
  await form.getByLabel("Rule name").fill("Hyundai deals to Nissan");
  await form.getByLabel("Records of").selectOption({ label: "Deals" });
  await form.getByLabel("In territory").selectOption({ label: "HMNL – Lagos" });
  await form.getByLabel("Shared with (territory)").selectOption({ label: "SNMNL – Lagos" });
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Refused" })).toContainText("must never carry one brand's records to another brand's staff");
  await expect(page.getByTestId("sharing-rule")).toHaveCount(0);
});

test("Setup home: search finds a function by its description; a planned function says Coming soon; recently visited", async ({ page }) => {
  await login(page, "crmadmin");
  await page.goto("/setup");
  await expect(page.getByTestId("setup-category")).toHaveCount(15);
  await page.getByLabel("Search setup").fill("scoring by field values");
  await expect(page.getByTestId("setup-category").getByRole("link")).toHaveText(["Scoring Rules"]);
  await page.getByRole("link", { name: "Scoring Rules" }).click();
  await expect(page.getByTestId("setup-coming-soon")).toContainText("Scoring Rules is planned");
  await expect(page.getByTestId("setup-nav")).toBeVisible();
  await page.goto("/setup/currencies");
  await expect(page.getByLabel("Home currency")).toHaveValue("NGN");
  await page.goto("/setup");
  await expect(page.getByTestId("setup-recent").getByRole("link")).toHaveText(["Currencies", "Scoring Rules"]);
  // Super Admin functions are not on an administrator's Setup home
  await expect(page.getByTestId("setup-landing").getByRole("link", { name: "Security Policies" })).toHaveCount(0);
  await page.getByLabel("Search setup").fill("no such thing at all");
  await expect(page.getByTestId("setup-landing")).toContainText("No setup function matches");
});
