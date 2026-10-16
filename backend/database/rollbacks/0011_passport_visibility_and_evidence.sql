-- Revierte la estructura nueva. No borra pasaportes ni eventos ya registrados.
-- Si material_documents tiene filas, el migrador se niega a eliminarlas.

DROP TABLE IF EXISTS material_documents;

ALTER TABLE material_trace_events DROP FOREIGN KEY fk_material_trace_events_organization;
ALTER TABLE material_trace_events DROP INDEX uq_material_trace_events_operation;
ALTER TABLE material_trace_events DROP INDEX ix_material_trace_events_organization;
ALTER TABLE material_trace_events DROP COLUMN organization_id;
ALTER TABLE material_trace_events DROP COLUMN operation_key;

ALTER TABLE material_passports DROP CHECK ck_material_passports_visibility;
ALTER TABLE material_passports DROP COLUMN visibility;
