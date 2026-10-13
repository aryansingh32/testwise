-- Audit events and config history are append-only: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER config_change_append_only
  BEFORE UPDATE OR DELETE ON "ConfigChange"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER rule_change_append_only
  BEFORE UPDATE ON "TournamentRuleChange"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
