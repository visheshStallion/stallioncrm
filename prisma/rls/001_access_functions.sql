-- StallionCRM RLS (layer 2 of brand isolation) – role + access functions.
-- Mirrors src/server/access/visibility.ts. Applied by migration 20261004000100_rls.
-- Session variables are set per transaction by src/server/db/rls.ts:
--   app.user_id      text   – current user id
--   app.scope        text   – 'ALL' | 'TERRITORY'
--   app.memberships  jsonb  – [{"brandId": "...", "regionId": "..." | null}, ...]
-- Missing settings fail closed (no rows).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stallion_rls') THEN
    CREATE ROLE stallion_rls NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- The application's connection role switches to stallion_rls with SET LOCAL ROLE.
GRANT stallion_rls TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO stallion_rls;

CREATE OR REPLACE FUNCTION app_scope_all() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.scope', true), '') = 'ALL'
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_has_membership(p_brand text, p_region text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(
           coalesce(nullif(current_setting('app.memberships', true), ''), '[]')::jsonb
         ) AS m("brandId" text, "regionId" text)
    WHERE m."brandId" = p_brand
      AND (m."regionId" IS NULL OR m."regionId" = p_region)
  )
$$;

-- READ: scope ALL, or owner, or territory membership (BUSINESS_CONTEXT §5).
CREATE OR REPLACE FUNCTION app_can_read(p_brand text, p_region text, p_owner text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_scope_all()
      OR (app_user_id() IS NOT NULL AND p_owner = app_user_id())
      OR app_has_membership(p_brand, p_region)
$$;

-- CREATE: scope ALL or territory membership – ownership never grants a new territory.
CREATE OR REPLACE FUNCTION app_can_create(p_brand text, p_region text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_scope_all() OR app_has_membership(p_brand, p_region)
$$;

-- Enables RLS + the brand_isolation policies on a brand-owned table (columns brandId, regionId, ownerId).
-- Every new brand-owned model's migration calls: SELECT app_enable_brand_rls('"Model"');
CREATE OR REPLACE FUNCTION app_enable_brand_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS brand_read ON %s', p_table);
  EXECUTE format('DROP POLICY IF EXISTS brand_insert ON %s', p_table);
  EXECUTE format('DROP POLICY IF EXISTS brand_update ON %s', p_table);
  EXECUTE format('DROP POLICY IF EXISTS brand_delete ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY brand_read ON %s FOR SELECT TO stallion_rls USING (app_can_read("brandId", "regionId", "ownerId"))',
    p_table);
  EXECUTE format(
    'CREATE POLICY brand_insert ON %s FOR INSERT TO stallion_rls WITH CHECK (app_can_create("brandId", "regionId"))',
    p_table);
  EXECUTE format(
    'CREATE POLICY brand_update ON %s FOR UPDATE TO stallion_rls USING (app_can_read("brandId", "regionId", "ownerId")) WITH CHECK (app_can_read("brandId", "regionId", "ownerId"))',
    p_table);
  EXECUTE format(
    'CREATE POLICY brand_delete ON %s FOR DELETE TO stallion_rls USING (app_can_read("brandId", "regionId", "ownerId"))',
    p_table);
END
$$;
