/**
 * Production bootstrap (docs/GO_LIVE_CHECKLIST.md §1) – run ONCE on an empty, migrated database INSTEAD of the
 * seed. It creates what the application needs to start and nothing fictitious:
 *   regions, the roles and profiles of the permission matrix, the root territory, default automation, reports,
 *   case and layout settings – and the first administrator.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME="…" BOOTSTRAP_ADMIN_PASSWORD=… pnpm db:bootstrap
 *
 * The password comes from the environment (never from an argument or a file in the repository). Brands, users and
 * all business data are then entered in the application (Setup) or imported. Safe to re-run: it only adds what
 * is missing and never changes an existing administrator's password.
 */
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { PROFILES, PROFILE_DEFS, REGIONS, ROLE_PARENTS, ROLES } from "../prisma/seed-data";
import { ensureRootTerritory } from "../src/server/access/territory";

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim() || "CRM Administrator";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to the administrator's e-mail address");
  if (password.length < 12) throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD to a password of at least 12 characters");

  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count({ where: { email: { endsWith: "@stallioncrm.test" } } })) > 0) {
      throw new Error("This database contains the fictitious seed users – bootstrap is for an empty production database");
    }
    for (const region of REGIONS) await prisma.region.upsert({ where: { name: region }, update: {}, create: { name: region } });
    await ensureRootTerritory(prisma as never);

    const roles = new Map<string, string>();
    const pending = Object.entries(ROLE_PARENTS);
    while (pending.length) {
      const i = pending.findIndex(([, parent]) => parent === null || roles.has(parent));
      const [roleName, parent] = pending.splice(i, 1)[0]!;
      const existing = await prisma.role.findFirst({ where: { name: roleName } });
      const role = existing ?? (await prisma.role.create({ data: { name: roleName, parentRoleId: parent ? roles.get(parent) : null } }));
      roles.set(roleName, role.id);
    }
    for (const p of PROFILE_DEFS) {
      // an existing profile keeps the permissions an administrator may have changed
      await prisma.profile.upsert({ where: { name: p.name }, update: {}, create: { name: p.name, scope: p.scope, permissions: p.permissions, fieldPermissions: p.fieldPermissions } });
    }
    for (const fn of ["app_seed_automation", "app_seed_reports", "app_seed_cases", "app_seed_layouts"]) await prisma.$executeRawUnsafe(`SELECT ${fn}()`);

    const profile = await prisma.profile.findUniqueOrThrow({ where: { name: PROFILES.ADMIN } });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) console.log(`Administrator ${email} already exists – left unchanged.`);
    else {
      const rootId = await ensureRootTerritory(prisma as never);
      const user = await prisma.user.create({ data: { name, email, passwordHash: await hash(password), roleId: roles.get(ROLES.ADMIN)!, profileId: profile.id } });
      await prisma.territoryMember.create({ data: { userId: user.id, territoryId: rootId } });
      console.log(`Administrator ${email} created. Sign in, change the password and switch on two-step sign-in.`);
    }
    console.log("Bootstrap complete: regions, roles, profiles and defaults are in place. Next: Setup → Brands.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
