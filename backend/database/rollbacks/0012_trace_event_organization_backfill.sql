-- Revierte solo el relleno de los eventos creados por la migración de pasaportes.
-- No borra el historial.

UPDATE material_trace_events
SET organization_id = NULL
WHERE operation_key LIKE 'backfill-%';
