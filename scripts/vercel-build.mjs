/**
 * Build command on Vercel (vercel.json): applies pending migrations, then builds.
 * Vercel's Neon integration, connected with the prefix DATABASE_URL, only provides DATABASE_URL_UNPOOLED.
 * SEED_DEMO=1 (a build-time variable, set for ONE deployment of a test site) also loads the fictitious demo
 * data and test users – never set it for a production database.
 */
import { execSync } from "node:child_process";

const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || "" };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

if (!env.DATABASE_URL) throw new Error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set for this build");
run("prisma migrate deploy");
if (process.env.SEED_DEMO === "1") run("prisma db seed");
run("next build");
