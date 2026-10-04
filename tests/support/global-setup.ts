/**
 * Integration-test database.
 * - TEST_DATABASE_URL set (CI service container / docker compose) → migrate + seed it.
 * - otherwise → start a throw-away embedded PostgreSQL 16, migrate + seed, stop afterwards.
 */
import type { TestProject } from "vitest/node";
import { migrateAndSeed, startEmbeddedPostgres } from "../../scripts/lib/embedded-pg";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;

  if (!url) {
    const db = await startEmbeddedPostgres();
    url = db.url;
    stop = db.stop;
  }

  migrateAndSeed(url);
  project.provide("databaseUrl", url);

  return async () => {
    await stop?.();
  };
}
