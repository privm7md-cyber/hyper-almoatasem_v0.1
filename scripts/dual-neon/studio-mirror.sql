CREATE SCHEMA website_mirror;
REVOKE ALL ON SCHEMA website_mirror FROM PUBLIC;
CREATE TABLE website_mirror.source (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_id uuid NOT NULL UNIQUE
);
CREATE TABLE website_mirror.entities (
  source_id uuid NOT NULL REFERENCES website_mirror.source(source_id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  body jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, entity_type, entity_id)
);
CREATE TABLE website_mirror.receipts (
  source_id uuid NOT NULL REFERENCES website_mirror.source(source_id),
  event_id uuid NOT NULL,
  revision bigint NOT NULL,
  digest text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','stale')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, event_id),
  UNIQUE (source_id, revision)
);
CREATE TABLE website_mirror.rate_windows (
  source_id uuid PRIMARY KEY REFERENCES website_mirror.source(source_id),
  bucket bigint NOT NULL,
  count integer NOT NULL
);
