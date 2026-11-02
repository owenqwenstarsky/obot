-- Usage records are a permanent, append-only ledger.
-- Reject any UPDATE or DELETE (and TRUNCATE) at the database level.
CREATE OR REPLACE FUNCTION obot_usage_record_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'usage_record is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usage_record_no_update
  BEFORE UPDATE ON "usage_record"
  FOR EACH ROW EXECUTE FUNCTION obot_usage_record_immutable();

CREATE TRIGGER usage_record_no_delete
  BEFORE DELETE ON "usage_record"
  FOR EACH ROW EXECUTE FUNCTION obot_usage_record_immutable();

CREATE TRIGGER usage_record_no_truncate
  BEFORE TRUNCATE ON "usage_record"
  FOR EACH STATEMENT EXECUTE FUNCTION obot_usage_record_immutable();

-- Model prices are append-only history as well (new rows supersede old ones).
CREATE OR REPLACE FUNCTION obot_model_price_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model_price is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_price_no_update
  BEFORE UPDATE ON "model_price"
  FOR EACH ROW EXECUTE FUNCTION obot_model_price_immutable();

CREATE TRIGGER model_price_no_delete
  BEFORE DELETE ON "model_price"
  FOR EACH ROW EXECUTE FUNCTION obot_model_price_immutable();

-- Seed the single settings row.
INSERT INTO "app_settings" ("id", "updatedAt") VALUES ('global', NOW())
  ON CONFLICT ("id") DO NOTHING;
