-- StallionCRM RLS – table privileges for stallion_rls + policies on brand-owned tables.
-- Applied by migration 20261004000100_rls.

-- Shared / admin tables are readable; brand-owned tables are additionally filtered by RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stallion_rls;
-- Tables created by later migrations (run by the same owner) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stallion_rls;

-- Never reachable from a user-scoped session.
-- Guarded: _prisma_migrations does not exist in Prisma's shadow database (prisma migrate dev).
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM stallion_rls;
  END IF;
END
$$;
REVOKE ALL ON "AuditLog" FROM stallion_rls;

-- Password hashes are not selectable from a user-scoped session (column privileges).
-- Later migrations that add User columns must GRANT SELECT on them explicitly.
REVOKE SELECT ON "User" FROM stallion_rls;
GRANT SELECT ("id", "name", "email", "roleId", "profileId", "active", "managerId", "createdAt", "updatedAt")
  ON "User" TO stallion_rls;

-- Brand-owned tables.
SELECT app_enable_brand_rls('"Deal"');
