/**
 * Expression indexes for custom fields (prompt 12). DDL needs the table owner, so it lives in the db layer;
 * the caller (customization service) checks that the user is an administrator. Identifiers are never taken
 * from input as-is: the table comes from a fixed map and the api name must match the strict pattern.
 */
import "server-only";
import { unsafeDb } from "./unsafe";

const TABLES: Record<string, string> = { leads: "Lead", deals: "Deal", accounts: "Account", contacts: "Contact", cases: "Case" };
const API_NAME = /^[a-z][a-zA-Z0-9]{1,39}$/;

function names(module: string, apiName: string) {
  const table = TABLES[module];
  if (!table || !API_NAME.test(apiName)) throw new Error("Invalid custom field");
  return { table, index: `cf_${table}_${apiName}`.slice(0, 60) };
}

/** Index on ("customFields"->>'<apiName>') so that filters and sorting on the field can use it. */
export async function createCustomFieldIndex(module: string, apiName: string): Promise<void> {
  const { table, index } = names(module, apiName);
  await unsafeDb.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${index}" ON "${table}" (("customFields"->>'${apiName}'))`);
}

export async function dropCustomFieldIndex(module: string, apiName: string): Promise<void> {
  const { index } = names(module, apiName);
  await unsafeDb.$executeRawUnsafe(`DROP INDEX IF EXISTS "${index}"`);
}

export async function customFieldIndexExists(module: string, apiName: string): Promise<boolean> {
  const { index } = names(module, apiName);
  const rows = await unsafeDb.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${index}`;
  return (rows[0]?.n ?? 0) > 0;
}
