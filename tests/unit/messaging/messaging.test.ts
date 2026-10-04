import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidEmail, isValidSenderId, renderMerge, unknownFields } from "@/server/modules/messaging/merge";
import { providerFor, sandboxOutbox, textToHtml } from "@/server/modules/messaging/providers";
import { checkWebhookToken, verifyMetaSignature } from "@/server/webhook-auth";

describe("merge fields", () => {
  const data = { contact: { firstName: "Ada", name: "Ada Okafor" }, deal: { model: "SUV 2.0" }, brand: { name: "HMNL Motors", code: "HMNL" }, owner: { name: null } };
  it("renders known fields, leaves unknown ones empty and tolerates spaces", () => {
    expect(renderMerge("Dear {{contact.firstName}}, your {{ deal.model }} from {{brand.name}} ({{brand.code}}).", data)).toBe("Dear Ada, your SUV 2.0 from HMNL Motors (HMNL).");
    expect(renderMerge("{{owner.name}}|{{contact.nickname}}|{{nothing}}", data)).toBe("||");
    expect(renderMerge("Stop: {{unsubscribeUrl}}", data, { unsubscribeUrl: "https://x/u/1" })).toBe("Stop: https://x/u/1");
  });
  it("does not evaluate anything – values are inserted as text", () => {
    expect(renderMerge("{{contact.firstName}}", { contact: { firstName: "{{brand.name}}<script>" } })).toBe("{{brand.name}}<script>");
    expect(renderMerge("{{constructor.name}}|{{toString}}|{{contact.constructor}}", { contact: {} })).toBe("||");
  });
  it("reports merge fields the system does not know", () => {
    expect(unknownFields("Hi {{contact.firstName}} {{contact.nickname}} {{deal.colour}} {{unsubscribeUrl}}")).toEqual(["contact.nickname", "deal.colour"]);
  });
  it("validates sender IDs and email addresses", () => {
    expect(isValidSenderId("HMNL")).toBe(true);
    expect(isValidSenderId("AB")).toBe(false);
    expect(isValidSenderId("TooLongSender")).toBe(false);
    expect(isValidEmail("a.b@example.test")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a@b.c, evil@x.y")).toBe(false);
    expect(isValidEmail("a b@x.y")).toBe(false);
  });
});

describe("providers", () => {
  it("fall back to the sandbox when nothing is configured, and the sandbox keeps the brand identity", async () => {
    for (const channel of ["EMAIL", "SMS", "WHATSAPP"] as const) expect(providerFor(channel).name).toBe("sandbox");
    const { providerMessageId } = await providerFor("SMS").send({ channel: "SMS", from: { address: "HMNL" }, to: "+2348012345678", text: "Hi" });
    expect(providerMessageId).toMatch(/^sandbox-/);
    expect(sandboxOutbox[sandboxOutbox.length - 1]).toMatchObject({ from: { address: "HMNL" }, to: "+2348012345678", providerMessageId });
  });
  it("email HTML is escaped text with clickable links", () => {
    const html = textToHtml('Hello <b>Ada</b> & co\nsee https://example.test/a?b=1 "now"');
    expect(html).toContain("Hello &lt;b&gt;Ada&lt;/b&gt; &amp; co<br>see ");
    expect(html).toContain('<a href="https://example.test/a?b=1">');
    expect(html).not.toContain("<b>");
  });
});

describe("webhook authentication", () => {
  it("accepts the shared token in the query or the Authorization header only", () => {
    expect(checkWebhookToken(new Request("https://crm.test/hook?token=s3cret"), "s3cret")).toBe("ok");
    expect(checkWebhookToken(new Request("https://crm.test/hook", { headers: { authorization: "Bearer s3cret" } }), "s3cret")).toBe("ok");
    expect(checkWebhookToken(new Request("https://crm.test/hook?token=wrong"), "s3cret")).toBe("denied");
    expect(checkWebhookToken(new Request("https://crm.test/hook"), "s3cret")).toBe("denied");
    expect(checkWebhookToken(new Request("https://crm.test/hook?token="), undefined)).toBe("disabled");
  });
  it("verifies Meta's body signature", () => {
    const body = '{"entry":[]}';
    const good = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, good, "app-secret")).toBe(true);
    expect(verifyMetaSignature(`${body} `, good, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, good, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "app-secret")).toBe(false);
  });
});
