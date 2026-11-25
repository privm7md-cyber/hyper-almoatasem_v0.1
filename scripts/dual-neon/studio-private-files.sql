CREATE SCHEMA studio_files;
REVOKE ALL ON SCHEMA studio_files FROM PUBLIC;
CREATE TABLE studio_files.objects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES studio_access.owner(id),
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('WORKBOOK_UPLOAD','WORKBOOK_EXPORT','BACKUP')),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','READY','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON studio_files.objects (expires_at);
CREATE TABLE studio_files.download_grants (
  token_digest text PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES studio_files.objects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES studio_access.owner(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON studio_files.download_grants (expires_at);
