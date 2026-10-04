/**
 * Starts a real PostgreSQL 16 server from the `embedded-postgres` npm binaries.
 * Used when Docker is not available (local dev without docker, tests, e2e).
 * CI and `docker compose up` use the official postgres:16 image instead.
 */
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export async function startEmbeddedPostgres(opts: {
  dataDir?: string;
  port?: number;
  database?: string;
  persistent?: boolean;
} = {}): Promise<EmbeddedDb> {
  const persistent = opts.persistent ?? false;
  const dataDir =
    opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "stallioncrm-pg-"));
  const port = opts.port ?? (await freePort());
  const database = opts.database ?? "stallioncrm";
  const user = "postgres";
  const password = "postgres";

  const alreadyInitialised = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!persistent && fs.existsSync(dataDir)) {
    // mkdtemp creates the dir; initdb needs it absent or empty – it is empty here.
  }

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent,
    onLog: () => {},
    onError: (e) => {
      if (process.env.DEBUG_PG) console.error(e);
    },
  });

  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch {
    // already exists (persistent data dir)
  }

  return {
    url: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`,
    stop: async () => {
      await pg.stop();
      if (!persistent) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Runs `prisma migrate deploy` (and optionally the seed) against `url`. */
export function migrateAndSeed(url: string, { seed = true } = {}): void {
  const env = { ...process.env, DATABASE_URL: url };
  const prismaBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  execFileSync(prismaBin, ["migrate", "deploy"], {
    env,
    stdio: process.env.DEBUG_PG ? "inherit" : "pipe",
    shell: process.platform === "win32",
  });
  if (seed) {
    const tsxBin = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsx.cmd" : "tsx",
    );
    execFileSync(tsxBin, ["prisma/seed.ts"], {
      env,
      stdio: process.env.DEBUG_PG ? "inherit" : "pipe",
      shell: process.platform === "win32",
    });
  }
}
