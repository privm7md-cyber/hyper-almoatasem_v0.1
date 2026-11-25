-- Apply in the independently verified Studio staging database after the schema
-- import, using existing dedicated login roles. The migration role owns objects.
BEGIN;

GRANT USAGE ON SCHEMA studio, studio_access, studio_files, website_mirror TO studio_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA studio TO studio_runtime;
GRANT SELECT ON website_mirror.entities, website_mirror.receipts TO studio_runtime;

GRANT INSERT ON studio.audit_events, studio.edit_journal, studio.owner_activity,
  studio.session_provenance, studio.review_checkpoints, studio.review_events,
  studio.catalog_releases, studio.release_snapshots, studio.release_receipts,
  studio.reference_dependencies, studio.draft_entities
TO studio_runtime;
GRANT USAGE ON SEQUENCE studio.edit_journal_journal_seq_seq TO studio_runtime;

GRANT INSERT, UPDATE ON studio.app_state, studio.browser_sessions, studio.bulk_batches,
  studio.catalog_drafts, studio.dq_findings, studio.duplicate_findings, studio.editor_drafts,
  studio.excel_jobs, studio.import_previews, studio.operation_state, studio.product_field_revisions,
  studio.products, studio.product_codes, studio.product_variants, studio.reference_aliases,
  studio.reference_entities, studio.release_previews, studio.review_progress, studio.review_sessions,
  studio.search_index_meta, studio.variant_field_revisions, studio.variant_drafts
TO studio_runtime;
GRANT INSERT, UPDATE, DELETE ON studio.brand_categories, studio.bulk_selections,
  studio.product_code_drafts, studio.product_drafts, studio.product_effective_index,
  studio.product_search_index, studio.products_effective_fts, studio.products_fts
TO studio_runtime;
GRANT UPDATE ON studio.brand_suggestions TO studio_runtime;
GRANT INSERT ON studio.brand_suggestions TO studio_runtime;

GRANT SELECT (singleton, id, enabled, password_hash) ON studio_access.owner TO studio_runtime;
GRANT SELECT, INSERT, DELETE ON studio_access.sessions TO studio_runtime;
GRANT SELECT, INSERT, UPDATE ON studio_access.login_windows TO studio_runtime;
GRANT SELECT, INSERT, UPDATE ON studio_files.objects TO studio_runtime;
GRANT SELECT, INSERT, DELETE ON studio_files.download_grants TO studio_runtime;

GRANT USAGE ON SCHEMA website_mirror TO studio_mirror_worker;
GRANT SELECT ON website_mirror.source, website_mirror.receipts TO studio_mirror_worker;
GRANT INSERT ON website_mirror.receipts TO studio_mirror_worker;
GRANT SELECT, INSERT, UPDATE ON website_mirror.entities, website_mirror.rate_windows TO studio_mirror_worker;

GRANT USAGE ON SCHEMA studio, website_mirror TO studio_verify, studio_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA studio, website_mirror TO studio_verify, studio_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA studio TO studio_backup;

COMMIT;
