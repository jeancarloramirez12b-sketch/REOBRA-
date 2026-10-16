-- Quita la organización solo de eventos que no tienen clave de operación.
-- No borra el historial.

UPDATE material_trace_events
SET organization_id = NULL
WHERE operation_key IS NULL;
