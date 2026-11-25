-- Install through an isolated website staging migration. This file is outside the
-- website migration chain and has no deployment hook.
CREATE SCHEMA catalog_feed;
REVOKE ALL ON SCHEMA catalog_feed FROM PUBLIC;

CREATE TABLE catalog_feed.source (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_id uuid NOT NULL
);
CREATE SEQUENCE catalog_feed.revision;
CREATE TABLE catalog_feed.entity_state (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  body jsonb,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE TABLE catalog_feed.outbox (
  revision bigint PRIMARY KEY DEFAULT nextval('catalog_feed.revision'),
  event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  body jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  delivered_at timestamptz,
  dead_at timestamptz
);
CREATE INDEX feed_pending ON catalog_feed.outbox (available_at, revision)
  WHERE delivered_at IS NULL AND dead_at IS NULL;
CREATE TABLE catalog_feed.reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  scanned integer NOT NULL,
  emitted integer NOT NULL,
  last_enqueued_revision bigint
);

-- An explicit allowlist keeps prices exact and excludes cost and operational data.
CREATE FUNCTION catalog_feed.project(entity_type text, fields jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
  SELECT jsonb_object_agg(key, value)
  FROM jsonb_each(fields)
  WHERE key = ANY (CASE entity_type
    WHEN 'products' THEN ARRAY['name','slug','category_id','brand_id','product_type','unit','sale_step_grams','is_active','deleted_at']
    WHEN 'product_variants' THEN ARRAY['product_id','name','price','size_value','size_unit','is_active','deleted_at']
    WHEN 'product_codes' THEN ARRAY['product_variant_id','code','type','is_primary']
    WHEN 'categories' THEN ARRAY['name','slug','parent_id','is_active','sort_order','deleted_at']
    WHEN 'brands' THEN ARRAY['name','slug','is_active','deleted_at']
    END);
$$;

CREATE FUNCTION catalog_feed.record_entity(kind text, id uuid, payload jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN
  INSERT INTO catalog_feed.entity_state AS state VALUES (kind, id, payload)
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET body = excluded.body
  WHERE state.body IS DISTINCT FROM excluded.body;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO catalog_feed.outbox(source_id, entity_type, entity_id, body)
  VALUES ((SELECT source_id FROM catalog_feed.source), kind, id, payload);
  RETURN true;
END;
$$;

CREATE FUNCTION catalog_feed.capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE fields jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM catalog_feed.record_entity(TG_TABLE_NAME, OLD.id, NULL);
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
      PERFORM catalog_feed.record_entity(TG_TABLE_NAME, OLD.id, NULL);
    END IF;
    fields := to_jsonb(NEW);
    IF TG_TABLE_NAME = 'product_variants' THEN
      fields := fields || jsonb_build_object('price', fields->>'price', 'size_value', fields->>'size_value');
    END IF;
    PERFORM catalog_feed.record_entity(TG_TABLE_NAME, NEW.id, catalog_feed.project(TG_TABLE_NAME, fields));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER catalog_feed AFTER INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION catalog_feed.capture();
CREATE TRIGGER catalog_feed AFTER INSERT OR UPDATE OR DELETE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION catalog_feed.capture();
CREATE TRIGGER catalog_feed AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION catalog_feed.capture();
CREATE TRIGGER catalog_feed AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION catalog_feed.capture();
CREATE TRIGGER catalog_feed AFTER INSERT OR UPDATE OR DELETE ON public.product_codes
  FOR EACH ROW EXECUTE FUNCTION catalog_feed.capture();

-- Run with a short lock timeout and an explicit execution time limit. Taking
-- the locks before scanning makes the complete snapshot consistent with capture.
CREATE FUNCTION catalog_feed.reconcile(max_entities integer) RETURNS integer
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  kind text;
  changes integer := 0;
  scanned integer := 0;
  entity record;
  fields jsonb;
BEGIN
  IF max_entities IS NULL OR max_entities < 1 OR max_entities > 250000 THEN
    RAISE EXCEPTION 'invalid reconciliation limit';
  END IF;
  LOCK TABLE public.categories, public.brands, public.products, public.product_variants, public.product_codes
    IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(192761532, 1);
  FOREACH kind IN ARRAY ARRAY['categories','brands','products','product_variants','product_codes'] LOOP
    FOR entity IN EXECUTE format('SELECT id, to_jsonb(row) AS body FROM public.%I row LIMIT $1', kind)
      USING max_entities - scanned + 1
    LOOP
      scanned := scanned + 1;
      IF scanned > max_entities THEN RAISE EXCEPTION 'reconciliation limit exceeded'; END IF;
      fields := entity.body;
      IF kind = 'product_variants' THEN
        fields := fields || jsonb_build_object('price', fields->>'price', 'size_value', fields->>'size_value');
      END IF;
      IF catalog_feed.record_entity(kind, entity.id, catalog_feed.project(kind, fields)) THEN
        changes := changes + 1;
      END IF;
    END LOOP;
    FOR entity IN EXECUTE format('SELECT s.entity_id FROM catalog_feed.entity_state s
        WHERE s.entity_type = $1 AND s.body IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.%I t WHERE t.id = s.entity_id) LIMIT $2', kind)
      USING kind, max_entities - scanned + 1
    LOOP
      scanned := scanned + 1;
      IF scanned > max_entities THEN RAISE EXCEPTION 'reconciliation limit exceeded'; END IF;
      IF catalog_feed.record_entity(kind, entity.entity_id, NULL) THEN changes := changes + 1; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO catalog_feed.reconciliations(scanned, emitted, last_enqueued_revision)
  VALUES (scanned, changes, (SELECT max(revision) FROM catalog_feed.outbox));
  RETURN changes;
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_feed FROM PUBLIC;
