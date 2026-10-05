import { z } from "zod";
import { criteriaFields, criteriaSchema, type Criteria } from "@/server/automation/criteria";
import { fieldMap, FUNCTIONS, RECIPIENTS, wfModule } from "./modules";

const text = (max: number) => z.string().trim().min(1).max(max);
const recipient = z.enum(RECIPIENTS);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIELD_UPDATE"), field: text(60), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]) }),
  z.object({
    type: z.literal("CREATE_TASK"),
    subject: text(200),
    dueInHours: z.coerce.number().min(0).max(24 * 365).default(24),
    assignee: z.enum(["OWNER", "BRAND_MANAGER"]).default("OWNER"),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
    activityType: z.enum(["TASK", "CALL"]).default("TASK"),
  }),
  z.object({ type: z.literal("SEND_NOTIFICATION"), to: recipient, roleName: z.string().max(80).optional(), title: text(200), body: z.string().max(500).optional() }),
  z.object({ type: z.literal("SEND_EMAIL"), to: recipient, roleName: z.string().max(80).optional(), subject: text(200), body: z.string().max(5000).default("") }),
  // the record as a PDF with a document template, e-mailed to its customer as the record's owner (prompt 21)
  z.object({ type: z.literal("SEND_DOCUMENT"), documentTemplate: z.string().trim().max(80).default("default"), emailTemplateId: z.string().trim().max(40).optional() }),
  z.object({ type: z.literal("WEBHOOK"), url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Webhooks must use https") }),
  z.object({ type: z.literal("ASSIGN_OWNER"), to: z.enum(["BRAND_MANAGER", "USER"]), userId: z.string().max(40).optional() }),
  z.object({ type: z.literal("CALL_FUNCTION"), name: z.enum(FUNCTIONS.map((f) => f.name) as [string, ...string[]]) }),
]);
export type WorkflowAction = z.infer<typeof actionSchema>;

export const TRIGGERS = ["ON_CREATE", "ON_EDIT", "FIELD_CHANGE", "DATE_BASED", "SCHEDULED"] as const;

export const ruleSchema = z
  .object({
    name: text(120),
    description: z.string().trim().max(500).optional().transform((v) => v || null),
    module: z.enum(["leads", "deals", "quotes", "salesOrders", "cases"]),
    trigger: z.enum(TRIGGERS),
    triggerConfig: z
      .object({ field: z.string().max(60).optional(), dateField: z.string().max(60).optional(), offsetDays: z.coerce.number().int().min(-365).max(365).optional(), repeat: z.enum(["ONCE", "PER_UPDATE"]).optional() })
      .default({}),
    brandId: z.string().max(40).nullish().transform((v) => v || null),
    criteria: criteriaSchema.default({}),
    actions: z.array(actionSchema).min(1, "Add at least one action").max(10),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    const mod = wfModule(r.module)!;
    const fields = fieldMap(mod);
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    for (const f of criteriaFields(r.criteria as Criteria)) if (!fields[f]) issue("criteria", `Unknown field "${f}" for ${mod.label}`);
    if (r.trigger === "FIELD_CHANGE" && !fields[r.triggerConfig.field ?? ""]?.watchable) issue("triggerConfig", "Choose the field to watch");
    if (r.trigger === "DATE_BASED" && fields[r.triggerConfig.dateField ?? ""]?.type !== "date") issue("triggerConfig", "Choose a date field");
    if (r.trigger === "SCHEDULED" && !(r.criteria.all?.length || r.criteria.any?.length)) issue("criteria", "A scheduled rule needs criteria");
    r.actions.forEach((a) => {
      if (a.type === "FIELD_UPDATE" && !fields[a.field]?.updatable) issue("actions", `Field "${a.field}" cannot be updated by a rule`);
      if (a.type === "CALL_FUNCTION" && a.name === "escalateCase" && r.module !== "cases") issue("actions", "escalateCase applies to cases");
      if (a.type === "CALL_FUNCTION" && a.name === "copyBrandFromDeal" && r.module !== "quotes" && r.module !== "salesOrders") issue("actions", "copyBrandFromDeal applies to quotes and sales orders");
      if ((a.type === "SEND_NOTIFICATION" || a.type === "SEND_EMAIL") && a.to === "ROLE" && !a.roleName) issue("actions", "Choose the role to notify");
      if (a.type === "ASSIGN_OWNER" && a.to === "USER" && !a.userId) issue("actions", "Choose the new owner");
    });
  });
export type RuleInput = z.input<typeof ruleSchema>;
