-- Fase 1: o campo provisório is_super_admin vira uma atribuição do papel super_admin.
INSERT INTO "role_assignments" ("id", "user_id", "role", "org_unit_id", "created_at")
SELECT gen_random_uuid(), "id", 'super_admin', NULL, now()
FROM "users"
WHERE "is_super_admin" = true
ON CONFLICT DO NOTHING;
