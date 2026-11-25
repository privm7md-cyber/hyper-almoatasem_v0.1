CREATE SCHEMA studio_access;
REVOKE ALL ON SCHEMA studio_access FROM PUBLIC;
CREATE TABLE studio_access.owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE studio_access.sessions (
  token_digest text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES studio_access.owner(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON studio_access.sessions (expires_at);
CREATE TABLE studio_access.login_windows (
  scope text NOT NULL,
  bucket bigint NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (scope, bucket)
);
CREATE FUNCTION studio_access.revoke_on_owner_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
BEGIN
  DELETE FROM studio_access.sessions WHERE owner_id = OLD.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER revoke_on_owner_change
AFTER UPDATE OF password_hash, enabled ON studio_access.owner
FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.enabled IS DISTINCT FROM NEW.enabled)
EXECUTE FUNCTION studio_access.revoke_on_owner_change();
REVOKE ALL ON FUNCTION studio_access.revoke_on_owner_change() FROM PUBLIC;
