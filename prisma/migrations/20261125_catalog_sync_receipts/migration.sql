-- CS-08 persistence. This migration creates receipt and identity tables.
-- Installing the schema does not authorize real catalog apply or event capture.
CREATE TABLE sync_entity_maps (
  studio_id varchar(255) PRIMARY KEY,
  website_id uuid NOT NULL,
  kind varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sync_entity_map_pair UNIQUE (kind, studio_id)
);
CREATE TABLE sync_idempotency (
  idempotency_key varchar(255) PRIMARY KEY,
  manifest_id varchar(255) NOT NULL,
  studio_source_id varchar(255) NOT NULL,
  status varchar(16) NOT NULL,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_idempotency_source ON sync_idempotency (studio_source_id);
CREATE TABLE sync_apply_receipts (
  sync_job_id text PRIMARY KEY,
  manifest_id text NOT NULL,
  digest varchar(255) NOT NULL,
  actor_id uuid NOT NULL,
  target_database varchar(64) NOT NULL,
  target_system_identifier varchar(64) NOT NULL,
  actor_permission varchar(255) NOT NULL,
  status varchar(16) NOT NULL,
  applied_count integer NOT NULL,
  already_applied_count integer NOT NULL,
  conflicted_count integer NOT NULL,
  failed_count integer NOT NULL,
  audit_event_count integer NOT NULL,
  result_digest varchar(255),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_sync_apply_receipts_manifest ON sync_apply_receipts (manifest_id);
CREATE INDEX idx_sync_apply_receipts_actor ON sync_apply_receipts (actor_id);
