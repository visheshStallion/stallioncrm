import { RULE_OPS, type LayoutDef, type LayoutRule } from "./engine";

/**
 * The layout editor's text notation (one item per line), kept deliberately simple for administrators:
 *   sections: `Section title: cf_colour, cf_trim`
 *   required: `mobile, cf_colour`
 *   rules:    `REQUIRE cf_financeBank WHEN paymentType eq FINANCE`
 *             `HIDE cf_tradeInVin WHEN cf_hasTradeIn neq true`
 *             `SHOW cf_fleetSize WHEN cf_segment notEmpty`
 */
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function parseLayoutText(input: { sections: string; required: string; rules: string }): LayoutDef {
  const sections = lines(input.sections).map((line) => {
    const i = line.indexOf(":");
    if (i < 1) throw new Error(`Section "${line}": write it as "Title: field, field"`);
    return { title: line.slice(0, i).trim(), fields: list(line.slice(i + 1)) };
  });
  const rules = lines(input.rules).map((line): LayoutRule => {
    const m = /^(SHOW|HIDE|REQUIRE)\s+(.+?)\s+WHEN\s+(\S+)\s+(\S+)(?:\s+(.+))?$/i.exec(line);
    if (!m) throw new Error(`Rule "${line}": write it as "REQUIRE field, field WHEN field eq value"`);
    const op = RULE_OPS.find((o) => o.toLowerCase() === m[4]!.toLowerCase());
    if (!op) throw new Error(`Rule "${line}": unknown operator ${m[4]} (use ${RULE_OPS.join(", ")})`);
    return { action: m[1]!.toUpperCase() as LayoutRule["action"], fields: list(m[2]!), when: { field: m[3]!, op, ...(m[5] !== undefined ? { value: m[5].trim() } : {}) } };
  });
  return { sections, required: list(input.required.replace(/\r?\n/g, ",")), rules };
}

export function layoutToText(layout: LayoutDef): { sections: string; required: string; rules: string } {
  return {
    sections: layout.sections.map((s) => `${s.title}: ${s.fields.join(", ")}`).join("\n"),
    required: layout.required.join(", "),
    rules: layout.rules.map((r) => `${r.action} ${r.fields.join(", ")} WHEN ${r.when.field} ${r.when.op}${r.when.value !== undefined && r.when.value !== null ? ` ${r.when.value}` : ""}`).join("\n"),
  };
}
