-- ============================================================================
-- STAGING-ONLY least-privilege runtime grants for hyper_app.
-- Pattern document for the future production grant round (same statements,
-- different database). Applied AS hyper_migrator (database owner) on the
-- staging database ONLY. Never on hyper_almoatasem without explicit approval.
-- Scope: admin-auth surface only. No DELETE anywhere. No INSERT into users
-- (no signup flow exists). No rights on _prisma_migrations (migration
-- metadata is migrator-owned). No DDL. Future features add their own
-- explicit per-table grants; no blanket grants, no default privileges.
-- ============================================================================
GRANT USAGE ON SCHEMA public TO hyper_app;

-- users: read identity + write lockout/login-state columns only.
GRANT SELECT, UPDATE ON users TO hyper_app;

-- admin_sessions: full lifecycle except delete (rows are history).
GRANT SELECT, INSERT, UPDATE ON admin_sessions TO hyper_app;

-- admin_auth_tokens: create + atomic consume.
GRANT SELECT, INSERT, UPDATE ON admin_auth_tokens TO hyper_app;

-- admin_auth_rate_limits: buckets incl. TTL cleanup (needs DELETE).
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_auth_rate_limits TO hyper_app;

-- audit_logs: append-only writes from the app (SELECT arrives with the
-- future audit-viewer feature, deliberately not granted yet).
GRANT INSERT ON audit_logs TO hyper_app;

-- RBAC mapping tables: read-only effective-grant evaluation. getCurrentAdmin
-- joins users -> user_roles -> roles -> role_permissions -> permissions on
-- EVERY authenticated request; without these four SELECTs every logged-in
-- page 500s (proven live on staging: disabled_session_dead returned 500).
-- Read-only, no mapping mutation is ever granted to the app role.
GRANT SELECT ON roles TO hyper_app;
GRANT SELECT ON user_roles TO hyper_app;
GRANT SELECT ON permissions TO hyper_app;
GRANT SELECT ON role_permissions TO hyper_app;
