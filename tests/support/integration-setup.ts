/**
 * Per-test-file database: each integration file gets its own copy of the seeded template database
 * (CREATE DATABASE … TEMPLATE …), so files that change organisation data (admin tests) cannot affect
 * others. Runs before any module that constructs the Prisma client is imported.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, inject } from "vitest";

const templateUrl = new URL(inject("databaseUrl"));
const templateDb = templateUrl.pathname.slice(1);
const fileDb = `${templateDb}_t${process.pid}_${Date.now().toString(36)}`;

const maintenanceUrl = new URL(templateUrl);
maintenanceUrl.pathname = "/postgres";

async function maintenance(sql: string) {
  const client = new PrismaClient({ datasourceUrl: maintenanceUrl.toString() });
  try {
    await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

await maintenance(`CREATE DATABASE "${fileDb}" TEMPLATE "${templateDb}"`);

const fileUrl = new URL(templateUrl);
fileUrl.pathname = `/${fileDb}`;
process.env.DATABASE_URL = fileUrl.toString();
// Never reuse a client cached on globalThis by a previous file in the same worker.
delete (globalThis as { __stallionPrisma?: unknown }).__stallionPrisma;

afterAll(async () => {
  await maintenance(`DROP DATABASE IF EXISTS "${fileDb}" WITH (FORCE)`);
});
