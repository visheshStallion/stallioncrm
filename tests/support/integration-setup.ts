import { inject } from "vitest";

// Must run before any module that constructs the Prisma client is imported.
process.env.DATABASE_URL = inject("databaseUrl");
