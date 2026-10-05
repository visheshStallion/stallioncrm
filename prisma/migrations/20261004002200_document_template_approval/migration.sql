-- Approval of shared document templates (prompt 21 §4) with the approval engine of prompt 08: one step, decided by
-- a Brand Admin of the template's brand (administrators when the brand has none).
-- A separate migration: the enum value BRAND_ADMIN_OF_RECORD is added by the previous one and can only be used
-- after that migration has been committed. Idempotent: also called by the dev seed after its TRUNCATE.
CREATE OR REPLACE FUNCTION app_seed_document_templates() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'INSERT INTO "ApprovalProcess" (id, key, name, module, criteria, "updatedAt") VALUES
  (''ap_document_template'', ''DOCUMENT_TEMPLATE'', ''Document template'', ''*'', ''{}'', now())
  ON CONFLICT DO NOTHING';
  EXECUTE 'INSERT INTO "ApprovalStep" (id, "processId", "order", slot, "approverType", "roleName", condition) VALUES
  (''aps_document_template_1'', ''ap_document_template'', 1, NULL, ''BRAND_ADMIN_OF_RECORD'', NULL, NULL)
  ON CONFLICT DO NOTHING';
END
$fn$;

SELECT app_seed_document_templates();
